from decimal import Decimal

from django.db import transaction
from django.db.models import Case, DecimalField, F, Sum, When

from ..models import Expense, Investment, InvestmentMovement, PaymentMethod
from .dates import add_months, month_start
from .installments import generate_installments

ZERO = Decimal("0")

SIGNED = Sum(
    Case(
        When(kind=InvestmentMovement.WITHDRAWAL, then=-F("amount")),
        default=F("amount"),
        output_field=DecimalField(max_digits=14, decimal_places=2),
    )
)


@transaction.atomic
def sync_expense(movement):
    """Aporte vira um lançamento pago no orçamento; outros tipos não geram lançamento."""
    if movement.kind != InvestmentMovement.DEPOSIT:
        if movement.expense_id:
            expense = movement.expense
            movement.expense = None
            movement.save(update_fields=["expense"])
            expense.delete()
        return movement
    investment = movement.investment
    expense = movement.expense or Expense(user=movement.user, kind=Expense.INVESTMENT)
    expense.description = f"Aporte · {investment.name}"
    expense.date = movement.date
    expense.total_amount = movement.amount
    expense.installments_count = 1
    expense.payment_method = PaymentMethod.TRANSFER
    expense.category = investment.category
    expense.notes = movement.notes
    expense.save()
    generate_installments(expense)
    if movement.expense_id != expense.id:
        movement.expense = expense
        movement.save(update_fields=["expense"])
    return movement


@transaction.atomic
def delete_movement(movement):
    expense = movement.expense
    movement.delete()
    if expense:
        expense.delete()


def balance(investment):
    return investment.movements.aggregate(t=SIGNED)["t"] or ZERO


@transaction.atomic
def set_balance(investment, value, date, notes=""):
    """Registra o saldo atual: a diferença para o saldo calculado vira rendimento."""
    diff = Decimal(value) - balance(investment)
    if diff == 0:
        return None
    return InvestmentMovement.objects.create(
        user=investment.user, investment=investment, kind=InvestmentMovement.YIELD,
        date=date, amount=diff, notes=notes or "Atualização de saldo",
    )


def investment_stats(investment, month):
    month = month_start(month)
    next_month = add_months(month, 1)
    totals = {k: ZERO for k, _ in InvestmentMovement.KIND_CHOICES}
    for row in investment.movements.values("kind").annotate(t=Sum("amount")):
        totals[row["kind"]] = row["t"]
    in_month = {k: ZERO for k, _ in InvestmentMovement.KIND_CHOICES}
    rows = investment.movements.filter(date__gte=month, date__lt=next_month).values("kind").annotate(t=Sum("amount"))
    for row in rows:
        in_month[row["kind"]] = row["t"]
    invested = totals["aporte"] - totals["resgate"]
    current = invested + totals["rendimento"]
    return {
        "balance": current,
        "invested": invested,
        "yield_total": totals["rendimento"],
        "yield_pct": round(float(totals["rendimento"] / invested * 100), 2) if invested > 0 else None,
        "goal_pct": round(float(current / investment.goal * 100), 1) if investment.goal else None,
        "month_deposits": in_month["aporte"],
        "month_withdrawals": in_month["resgate"],
        "month_yield": in_month["rendimento"],
    }


def investments_summary(user, month):
    month = month_start(month)
    items = []
    for investment in Investment.objects.filter(user=user).select_related("category"):
        stats = investment_stats(investment, month)
        items.append({"id": investment.id, "name": investment.name, "type": investment.type,
                      "color": investment.color, "active": investment.active,
                      "monthly_target": investment.monthly_target, **stats})
    total = lambda key: sum((i[key] for i in items), ZERO)  # noqa: E731
    planned = sum((i["monthly_target"] or ZERO for i in items if i["active"]), ZERO)
    return {
        "count": sum(1 for i in items if i["active"]),
        "balance": total("balance"),
        "invested": total("invested"),
        "yield_total": total("yield_total"),
        "month_deposits": total("month_deposits"),
        "month_withdrawals": total("month_withdrawals"),
        "month_yield": total("month_yield"),
        "month_planned": planned,
        "items": items,
    }
