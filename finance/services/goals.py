from decimal import Decimal

from django.db import transaction
from django.db.models import Sum

from ..models import Category, Expense, GoalMovement, InvestmentMovement, PaymentMethod
from .dates import today
from .installments import generate_installments
from .investments import balance, delete_movement, sync_expense

ZERO = Decimal("0")
CENT = Decimal("0.01")


def months_between(start, end):
    return (end.year - start.year) * 12 + end.month - start.month


def goal_saved(goal):
    """Quanto já está guardado na meta.

    Com investimento vinculado, é o saldo dele. Sem, é o "já guardado" inicial + sobras
    destinadas + aportes − retiradas feitos na própria meta.
    """
    if goal.investment_id:
        return balance(goal.investment)
    saved = goal.initial_amount
    if goal.pk:
        saved += goal.allocations.filter(movement__isnull=True).aggregate(t=Sum("amount"))["t"] or ZERO
        for row in goal.movements.order_by().values("kind").annotate(t=Sum("amount")):
            saved += row["t"] if row["kind"] == GoalMovement.DEPOSIT else -row["t"]
    return saved


def goal_progress(goal, reference=None):
    """Quanto já foi juntado e quanto guardar por mês para bater a meta no prazo."""
    reference = reference or today()
    saved = goal_saved(goal)
    remaining = max(goal.target_amount - saved, ZERO)
    months_left = max(months_between(reference, goal.target_date), 1) if goal.target_date else None
    if months_left is None:
        suggested = None
    elif remaining == 0:
        suggested = ZERO
    else:
        suggested = (remaining / months_left).quantize(CENT)
    return {
        "saved": saved,
        "remaining": remaining,
        "progress_pct": min(max(saved / goal.target_amount * 100, ZERO), Decimal(100)).quantize(CENT),
        "months_left": months_left,
        "suggested_monthly": suggested,
    }


def goal_category(goal):
    """Grupo do lançamento de aporte: o da meta ou, sem ele, o 1º grupo ativo de Investimentos."""
    if goal.category_id:
        return goal.category
    return (
        Category.objects.filter(user=goal.user, scope=Category.INVESTMENT, active=True).order_by("id").first()
    )


@transaction.atomic
def move_goal(goal, kind, date, amount, notes=""):
    """Registra um aporte ou uma retirada na meta (validações ficam no serializer).

    Meta com investimento vinculado: vira aporte/resgate do investimento (o aporte gera o
    lançamento pela regra de Investimentos). Sem investimento: GoalMovement, e o aporte gera
    um lançamento pago do tipo "meta".
    """
    deposit = kind == GoalMovement.DEPOSIT
    if goal.investment_id:
        movement = InvestmentMovement.objects.create(
            user=goal.user, investment=goal.investment, date=date, amount=amount,
            kind=InvestmentMovement.DEPOSIT if deposit else InvestmentMovement.WITHDRAWAL,
            notes=notes or f"Meta · {goal.name}",
        )
        return sync_expense(movement)
    movement = GoalMovement.objects.create(
        user=goal.user, goal=goal, kind=kind, date=date, amount=amount, notes=notes
    )
    if deposit:
        expense = Expense.objects.create(
            user=goal.user, kind=Expense.GOAL, description=f"Aporte · {goal.name}", date=date,
            total_amount=amount, installments_count=1, payment_method=PaymentMethod.TRANSFER,
            category=goal_category(goal), notes=notes,
        )
        generate_installments(expense)
        movement.expense = expense
        movement.save(update_fields=["expense"])
    return movement


@transaction.atomic
def delete_goal_movement(movement):
    if isinstance(movement, InvestmentMovement):
        return delete_movement(movement)
    expense = movement.expense
    movement.delete()
    if expense:
        expense.delete()


@transaction.atomic
def delete_goal(goal):
    """Exclui a meta e os lançamentos dos aportes feitos nela."""
    Expense.objects.filter(goal_movement__goal=goal).delete()
    goal.delete()
