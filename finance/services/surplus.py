"""Saldo livre: o dinheiro real que sobra de um mês rola para o seguinte.

Para cada mês M, a partir do mês do primeiro recebimento do usuário:

    available(M) = carry_in(M) + received(M) − spent(M) − allocated(M)
    carry_in(M)  = available(M − 1)   (0 no primeiro mês; negativo também rola)

`spent` é o mesmo do dashboard: todas as parcelas da competência (pagas e pendentes)
mais as ocorrências ainda virtuais dos recorrentes. O saldo é calculado na hora, então
editar um mês passado recalcula os seguintes. Ele nunca entra no orçamento dos blocos.
"""

from collections import defaultdict
from decimal import Decimal

from django.db import transaction
from django.db.models import Sum
from django.db.models.functions import TruncMonth

from ..models import Income, Installment, InvestmentMovement, SurplusAllocation
from .dates import add_months, iter_months, month_start, today
from .recurring import materialize, virtual_occurrences

ZERO = Decimal("0")
EMPTY = {"carry_in": ZERO, "received": ZERO, "spent": ZERO, "allocated": ZERO, "available": ZERO}


def series_start(user):
    first = Income.objects.filter(user=user).order_by("date").values_list("date", flat=True).first()
    return month_start(first) if first else None


def free_balance(user, month, materialized=False):
    month = month_start(month)
    start = series_start(user)
    if start is None or month < start:
        return {**EMPTY, "start": start}
    if not materialized:
        materialize(user)
    end = add_months(month, 1)

    received = defaultdict(lambda: ZERO)
    rows = (
        Income.objects.filter(user=user, date__gte=start, date__lt=end)
        .annotate(m=TruncMonth("date"))
        .order_by()
        .values("m")
        .annotate(t=Sum("amount"))
    )
    for row in rows:
        received[month_start(row["m"])] += row["t"]

    spent = defaultdict(lambda: ZERO)
    rows = (
        Installment.objects.filter(user=user, competence__gte=start, competence__lte=month)
        .order_by()
        .values("competence")
        .annotate(t=Sum("amount"))
    )
    for row in rows:
        spent[row["competence"]] += row["t"]
    for v in virtual_occurrences(user, start, month):
        if start <= v["competence"] <= month:
            spent[v["competence"]] += v["amount"]

    allocated = defaultdict(lambda: ZERO)
    rows = (
        SurplusAllocation.objects.filter(user=user, competence__gte=start, competence__lte=month)
        .order_by()
        .values("competence")
        .annotate(t=Sum("amount"))
    )
    for row in rows:
        allocated[row["competence"]] += row["t"]

    carry = ZERO
    for m in iter_months(start, month):
        current = {
            "carry_in": carry,
            "received": received[m],
            "spent": spent[m],
            "allocated": allocated[m],
        }
        current["available"] = carry + received[m] - spent[m] - allocated[m]
        carry = current["available"]
    return {**current, "start": start}


def allocation_date(competence):
    """Data do aporte: hoje se for o mês corrente, senão o 1º dia da competência."""
    now = today()
    return now if month_start(now) == competence else competence


@transaction.atomic
def create_allocation(user, competence, amount, goal=None, investment=None, notes=""):
    target = investment or (goal.investment if goal else None)
    movement = None
    if target:
        label = f"Sobra de {competence:%m/%Y}"
        movement = InvestmentMovement.objects.create(
            user=user, investment=target, kind=InvestmentMovement.DEPOSIT,
            date=allocation_date(competence), amount=amount,
            notes=f"{label} · {notes}" if notes else label,
        )
    return SurplusAllocation.objects.create(
        user=user, competence=competence, amount=amount, goal=goal, investment=investment,
        movement=movement, notes=notes,
    )


@transaction.atomic
def delete_allocation(allocation):
    # O aporte é excluído junto (CASCADE apaga a destinação).
    if allocation.movement_id:
        allocation.movement.delete()
    else:
        allocation.delete()


def is_surplus_movement(movement):
    return movement.pk is not None and SurplusAllocation.objects.filter(movement=movement).exists()
