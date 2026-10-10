from decimal import Decimal

from django.db import transaction

from ..models import Expense, PaymentMethod, RecurringExpense
from .billing import invoice_cycle
from .dates import add_months, clamp_day, iter_months, month_start, today
from .installments import generate_installments


def _month_index(d):
    return d.year * 12 + d.month


def active_months(recurring, start, end):
    """Meses entre start e end (inclusive) em que o recorrente cobra.

    Mensal: todo mês vigente. Anual: só no mês de aniversário de `start_month`.
    """
    origin = month_start(recurring.start_month)
    first = max(origin, month_start(start))
    last = month_start(end)
    if recurring.end_month:
        last = min(last, month_start(recurring.end_month))
    months = iter_months(first, last)
    if recurring.frequency == RecurringExpense.YEARLY:
        return [m for m in months if (_month_index(m) - _month_index(origin)) % 12 == 0]
    return list(months)


def next_charge(recurring, after=None):
    """Data da próxima cobrança a partir de hoje (inclusive), ou None."""
    if not recurring.active:
        return None
    after = after or today()
    for month in active_months(recurring, month_start(after), add_months(after, 13)):
        charge = occurrence_date(recurring, month)
        if charge >= after:
            return charge
    return None


def monthly_equivalent(recurring):
    if recurring.frequency == RecurringExpense.YEARLY:
        return (recurring.amount / 12).quantize(Decimal("0.01"))
    return recurring.amount


def occurrence_date(recurring, month):
    return clamp_day(month, recurring.day)


@transaction.atomic
def materialize(user, until=None):
    """Cria os lançamentos dos recorrentes até o mês `until` (padrão: mês atual).

    Idempotente: cada (recorrente, mês) gera no máximo um lançamento.
    """
    until = month_start(until or today())
    for recurring in RecurringExpense.objects.filter(user=user, active=True):
        existing = set(recurring.expenses.values_list("recurring_month", flat=True))
        for month in active_months(recurring, recurring.start_month, until):
            if month in existing:
                continue
            is_credit = recurring.payment_method == PaymentMethod.CREDIT and recurring.card_id
            expense = Expense.objects.create(
                user=user,
                kind=Expense.RECURRING,
                description=recurring.description,
                date=occurrence_date(recurring, month),
                total_amount=recurring.amount,
                payment_method=recurring.payment_method,
                card=recurring.card if is_credit else None,
                category=recurring.category,
                recurring=recurring,
                recurring_month=month,
            )
            generate_installments(expense)


def virtual_occurrences(user, start, end):
    """Ocorrências futuras (não gravadas) dos recorrentes entre start e end.

    Retorna dicts com competence, amount, block_id, nature_id, category_id, card_id.
    """
    after = month_start(today())
    result = []
    recurrings = RecurringExpense.objects.filter(user=user, active=True).select_related(
        "category__nature", "card"
    )
    for recurring in recurrings:
        existing = set(recurring.expenses.values_list("recurring_month", flat=True))
        for month in active_months(recurring, start, end):
            if month <= after or month in existing:
                continue
            competence = month
            is_credit = recurring.payment_method == PaymentMethod.CREDIT and recurring.card_id
            if is_credit:
                competence = invoice_cycle(recurring.card, occurrence_date(recurring, month))[0]
            result.append(
                {
                    "competence": competence,
                    "amount": recurring.amount,
                    "description": recurring.description,
                    "block_id": recurring.category.nature.block_id,
                    "nature_id": recurring.category.nature_id,
                    "category_id": recurring.category_id,
                    "card_id": recurring.card_id if is_credit else None,
                    "payment_method": recurring.payment_method,
                }
            )
    return result
