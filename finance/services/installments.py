from decimal import ROUND_DOWN, Decimal

from django.db import transaction

from ..models import INSTANT_METHODS, Expense, Installment, Invoice, PaymentMethod
from .billing import cycle_for_competence, invoice_cycle
from .dates import add_months, month_start, today

CENT = Decimal("0.01")


def split_amount(total, count):
    """Divide em parcelas iguais (centavos para baixo); o resto vai na 1ª."""
    total = Decimal(total)
    base = (total / count).quantize(CENT, rounding=ROUND_DOWN)
    return [total - base * (count - 1)] + [base] * (count - 1)


def get_invoice(card, competence):
    closing, due = cycle_for_competence(card, competence)
    invoice, _ = Invoice.objects.get_or_create(
        user=card.user,
        card=card,
        competence=competence,
        defaults={"closing_date": closing, "due_date": due},
    )
    return invoice


def first_competence(expense):
    """Competência da 1ª parcela no cartão (override manual ou ciclo da fatura)."""
    if expense.first_due_date:
        return month_start(expense.first_due_date)
    return invoice_cycle(expense.card, expense.date)[0]


def delete_empty_invoices(user):
    Invoice.objects.filter(user=user, paid=False, installments__isnull=True).delete()


@transaction.atomic
def generate_installments(expense):
    """(Re)gera as parcelas de um lançamento, preservando o status de pagamento."""
    previous = {i.number: (i.paid, i.paid_at) for i in expense.installments.all()}
    expense.installments.all().delete()

    count = expense.installments_count
    if expense.installment_amount:
        amounts = [expense.installment_amount] * count
        total = expense.installment_amount * count
        if expense.total_amount != total:
            expense.total_amount = total
            Expense.objects.filter(pk=expense.pk).update(total_amount=total)
    else:
        amounts = split_amount(expense.total_amount, count)

    is_credit = expense.payment_method == PaymentMethod.CREDIT and expense.card_id
    auto_paid = expense.kind == Expense.INVESTMENT or (
        expense.payment_method in INSTANT_METHODS and expense.kind != Expense.DEBT
    )
    if is_credit:
        start = first_competence(expense)
    else:
        start = expense.first_due_date or expense.date

    rows = []
    for index, amount in enumerate(amounts):
        number = index + 1
        invoice = None
        if is_credit:
            competence = add_months(start, index)
            invoice = get_invoice(expense.card, competence)
            due_date = invoice.due_date
            paid, paid_at = invoice.paid, invoice.paid_at
        else:
            due_date = add_months(start, index)
            competence = month_start(due_date)
            paid = auto_paid and due_date <= today()
            paid_at = due_date if paid else None
        if number in previous and previous[number][0]:
            paid, paid_at = previous[number]
        rows.append(
            Installment(
                user=expense.user,
                expense=expense,
                number=number,
                amount=amount,
                due_date=due_date,
                competence=competence,
                invoice=invoice,
                paid=paid,
                paid_at=paid_at,
            )
        )
    Installment.objects.bulk_create(rows)
    delete_empty_invoices(expense.user)
    return rows


@transaction.atomic
def set_invoice_paid(invoice, paid, paid_at=None):
    invoice.paid = paid
    invoice.paid_at = (paid_at or today()) if paid else None
    invoice.save(update_fields=["paid", "paid_at"])
    invoice.installments.update(paid=paid, paid_at=invoice.paid_at)
    return invoice
