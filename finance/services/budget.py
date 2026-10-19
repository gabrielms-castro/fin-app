from collections import defaultdict
from decimal import Decimal

from django.db.models import Count, Q, Sum

from ..models import (
    Block,
    Category,
    CreditCard,
    Expense,
    Income,
    IncomeSource,
    Installment,
    Invoice,
    MonthPlan,
    Nature,
    PaymentMethod,
    RecurringExpense,
    get_settings,
)
from .dates import add_months, iter_months, month_start, today
from .investments import investments_summary
from .recurring import materialize, monthly_equivalent, virtual_occurrences

ZERO = Decimal("0")
CENT = Decimal("0.01")
# A partir de 80% do teto de parcelados o status vira "atenção".
WARNING_RATIO = Decimal("0.8")


def expected_income(user, month):
    plan = MonthPlan.objects.filter(user=user, competence=month).first()
    if plan:
        return plan.expected_income
    sources = IncomeSource.objects.filter(user=user, active=True, start_month__lte=month).filter(
        Q(end_month__isnull=True) | Q(end_month__gte=month)
    )
    return sources.aggregate(t=Sum("amount"))["t"] or ZERO


def installments_committed(user, months, exclude_expense=None):
    """Soma das parcelas de compras parceladas (2x ou mais) por competência.

    Vale qualquer forma de pagamento e grupo de gasto; dívidas ficam de fora
    (são acompanhadas na aba Dívidas).
    """
    qs = (
        Installment.objects.filter(user=user, competence__in=months, expense__installments_count__gt=1)
        .exclude(expense__kind=Expense.DEBT)
    )
    if exclude_expense:
        qs = qs.exclude(expense_id=exclude_expense)
    return {row["competence"]: row["t"] for row in qs.values("competence").annotate(t=Sum("amount"))}


def commitment(committed, income, ceiling_pct):
    """Compara o comprometido com parcelados ao teto (% da entrada esperada)."""
    ceiling_amount = (income * ceiling_pct / 100).quantize(CENT)
    if not committed:
        status = "ok"
    elif committed > ceiling_amount:
        status = "over"
    elif committed >= ceiling_amount * WARNING_RATIO:
        status = "warning"
    else:
        status = "ok"
    return {
        "committed": committed,
        "pct": (committed / income * 100).quantize(CENT) if income else ZERO,
        "ceiling_pct": ceiling_pct,
        "ceiling_amount": ceiling_amount,
        "excess": max(committed - ceiling_amount, ZERO),
        "status": status,
    }


def installments_commitment(user, month):
    month = month_start(month)
    committed = installments_committed(user, [month]).get(month, ZERO)
    return commitment(committed, expected_income(user, month), get_settings(user).installment_ceiling_pct)


def _pct(part, whole):
    return round(float(part / whole * 100), 1) if whole else None


def _block_rows(blocks, expected, used_by_block):
    rows = []
    for block in blocks:
        budget = block.budget_for(expected)
        used = used_by_block.get(block.id, ZERO)
        rows.append(
            {
                "id": block.id,
                "name": block.name,
                "color": block.color,
                "budget": budget,
                "used": used,
                "remaining": budget - used,
                "pct": _pct(used, budget),
            }
        )
    return rows


def _with_natures(blocks, natures, by_nature):
    """Detalha o utilizado de cada bloco por natureza."""
    for block in blocks:
        block["natures"] = [
            {"id": n.id, "name": n.name, "total": by_nature.get(n.id, ZERO)} for n in natures if n.block_id == block["id"]
        ]
    return blocks


def month_summary(user, month):
    materialize(user)
    month = month_start(month)
    installments = Installment.objects.filter(user=user, competence=month)
    virtual = [v for v in virtual_occurrences(user, month, month) if v["competence"] == month]

    def grouped(field, virtual_key):
        totals = defaultdict(lambda: ZERO)
        for row in installments.values(field).annotate(t=Sum("amount")):
            totals[row[field]] += row["t"]
        for v in virtual:
            totals[v[virtual_key]] += v["amount"]
        return totals

    by_block = grouped("expense__category__nature__block", "block_id")
    by_nature = grouped("expense__category__nature", "nature_id")
    by_category = grouped("expense__category", "category_id")
    by_method = grouped("expense__payment_method", "payment_method")
    by_card = grouped("expense__card", "card_id")

    expected = expected_income(user, month)
    received = (
        Income.objects.filter(user=user, date__year=month.year, date__month=month.month).aggregate(
            t=Sum("amount")
        )["t"]
        or ZERO
    )
    spent = sum(by_block.values(), ZERO)
    pending = installments.filter(paid=False).aggregate(t=Sum("amount"))["t"] or ZERO
    pending += sum((v["amount"] for v in virtual), ZERO)

    natures = Nature.objects.filter(user=user)
    categories = Category.objects.filter(user=user).select_related("nature")
    cards = {c.id: c for c in CreditCard.objects.filter(user=user)}
    method_labels = dict(PaymentMethod.choices)

    invoices = []
    for invoice in Invoice.objects.filter(user=user, competence=month).select_related("card"):
        status = "paga" if invoice.paid else ("fechada" if invoice.closing_date <= today() else "aberta")
        invoices.append(
            {
                "id": invoice.id,
                "card_id": invoice.card_id,
                "card": invoice.card.name,
                "color": invoice.card.color,
                "total": invoice.total,
                "closing_date": invoice.closing_date,
                "due_date": invoice.due_date,
                "status": status,
            }
        )

    return {
        "month": month,
        "expected_income": expected,
        "received": received,
        "spent": spent,
        "pending": pending,
        "balance_expected": expected - spent,
        "balance_received": received - spent,
        "blocks": _with_natures(_block_rows(Block.objects.filter(user=user), expected, by_block), natures, by_nature),
        "by_nature": [
            {"id": n.id, "name": n.name, "total": by_nature[n.id]} for n in natures if by_nature.get(n.id)
        ],
        "by_category": sorted(
            (
                {"id": c.id, "name": c.name, "nature": c.nature.name, "nature_id": c.nature_id, "total": by_category[c.id]}
                for c in categories
                if by_category.get(c.id)
            ),
            key=lambda r: r["total"],
            reverse=True,
        ),
        "by_payment_method": [
            {"method": k, "name": method_labels.get(k, k), "total": v} for k, v in by_method.items() if v
        ],
        "by_card": [
            {"id": k, "name": cards[k].name, "color": cards[k].color, "total": v}
            for k, v in by_card.items()
            if k and v and k in cards
        ],
        "invoices": invoices,
        "installments_commitment": installments_commitment(user, month),
        "debts": debts_summary(user),
        "subscriptions": subscriptions_summary(user),
        "investments": investments_summary(user, month),
    }


def subscriptions_summary(user):
    subs = RecurringExpense.objects.filter(user=user, kind=RecurringExpense.SUBSCRIPTION, active=True)
    return {
        "count": subs.count(),
        "monthly": sum((monthly_equivalent(s) for s in subs), ZERO),
    }


def debts_summary(user):
    rows = []
    debts = (
        Expense.objects.filter(user=user, kind=Expense.DEBT)
        .annotate(
            paid_total=Sum("installments__amount", filter=Q(installments__paid=True)),
            paid_count=Count("installments", filter=Q(installments__paid=True)),
        )
        .order_by("date")
    )
    for debt in debts:
        paid_total = debt.paid_total or ZERO
        remaining = debt.total_amount - paid_total
        if remaining <= 0:
            continue
        next_installment = debt.installments.filter(paid=False).order_by("due_date").first()
        rows.append(
            {
                "id": debt.id,
                "description": debt.description,
                "creditor": debt.creditor,
                "total": debt.total_amount,
                "paid": paid_total,
                "remaining": remaining,
                "paid_count": debt.paid_count,
                "installments_count": debt.installments_count,
                "next_due": next_installment.due_date if next_installment else None,
                "next_amount": next_installment.amount if next_installment else None,
            }
        )
    return rows


def projection(user, months=12, start=None):
    materialize(user)
    start = month_start(start or today())
    end = add_months(start, months - 1)
    blocks = list(Block.objects.filter(user=user))
    cards = {c.id: c for c in CreditCard.objects.filter(user=user)}

    by_month_block = defaultdict(lambda: defaultdict(lambda: ZERO))
    by_month_card = defaultdict(lambda: defaultdict(lambda: ZERO))
    rows = (
        Installment.objects.filter(user=user, competence__gte=start, competence__lte=end)
        .values("competence", "expense__category__nature__block", "expense__card")
        .annotate(t=Sum("amount"))
    )
    for row in rows:
        by_month_block[row["competence"]][row["expense__category__nature__block"]] += row["t"]
        if row["expense__card"]:
            by_month_card[row["competence"]][row["expense__card"]] += row["t"]
    for v in virtual_occurrences(user, start, end):
        if v["competence"] > end:
            continue
        by_month_block[v["competence"]][v["block_id"]] += v["amount"]
        if v["card_id"]:
            by_month_card[v["competence"]][v["card_id"]] += v["amount"]

    result = []
    for month in iter_months(start, end):
        expected = expected_income(user, month)
        committed = sum(by_month_block[month].values(), ZERO)
        result.append(
            {
                "month": month,
                "expected_income": expected,
                "committed": committed,
                "free": expected - committed,
                "committed_pct": _pct(committed, expected),
                "blocks": _block_rows(blocks, expected, by_month_block[month]),
                "cards": [
                    {"id": cid, "name": cards[cid].name, "color": cards[cid].color, "total": total}
                    for cid, total in by_month_card[month].items()
                    if cid in cards
                ],
            }
        )
    return {"months": result, "debts": debts_summary(user)}
