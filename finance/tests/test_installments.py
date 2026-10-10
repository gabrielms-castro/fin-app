from datetime import date
from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase

from finance.models import Expense, Invoice
from finance.services.installments import generate_installments, set_invoice_paid, split_amount

from .factories import card, category, expense, make_user

TODAY = date(2026, 10, 10)


@patch("finance.services.installments.today", lambda: TODAY)
class InstallmentTests(TestCase):
    def setUp(self):
        self.user = make_user()

    def test_split_puts_remainder_on_first(self):
        self.assertEqual(split_amount(Decimal("100"), 3), [Decimal("33.34"), Decimal("33.33"), Decimal("33.33")])
        self.assertEqual(sum(split_amount(Decimal("100"), 3)), Decimal("100"))

    def test_credit_purchase_installments_follow_invoices(self):
        c = card(self.user, closing_day=5, due_day=12)
        e = expense(self.user, "300.00", date(2026, 10, 6), "credito", 3, card=c)
        inst = list(e.installments.order_by("number"))
        self.assertEqual([i.competence for i in inst], [date(2026, 11, 1), date(2026, 12, 1), date(2027, 1, 1)])
        self.assertEqual([i.due_date for i in inst], [date(2026, 11, 12), date(2026, 12, 12), date(2027, 1, 12)])
        self.assertTrue(all(i.invoice_id for i in inst))
        self.assertFalse(any(i.paid for i in inst))
        self.assertEqual(Invoice.objects.filter(card=c).count(), 3)

    def test_first_due_date_override(self):
        c = card(self.user)
        e = expense(self.user, "100", date(2026, 10, 3), "credito", 2, card=c, first_due_date=date(2027, 1, 12))
        self.assertEqual(e.installments.first().competence, date(2027, 1, 1))

    def test_cash_purchase_is_paid_and_counts_in_purchase_month(self):
        e = expense(self.user, "50", date(2026, 10, 3), "dinheiro")
        i = e.installments.get()
        self.assertTrue(i.paid)
        self.assertEqual(i.competence, date(2026, 10, 1))

    def test_debt_with_fixed_installment(self):
        e = expense(
            self.user, "1", date(2026, 9, 15), "boleto", 10, kind=Expense.DEBT,
            installment_amount=Decimal("250"), first_due_date=date(2026, 10, 31),
            category=category(self.user, "Empréstimos e financiamentos"),
        )
        e.refresh_from_db()
        self.assertEqual(e.total_amount, Decimal("2500"))
        dues = list(e.installments.values_list("due_date", flat=True))
        self.assertEqual(dues[:3], [date(2026, 10, 31), date(2026, 11, 30), date(2026, 12, 31)])
        self.assertFalse(e.installments.filter(paid=True).exists())

    def test_regenerate_preserves_paid_and_cleans_invoices(self):
        c = card(self.user)
        e = expense(self.user, "300", date(2026, 10, 3), "credito", 3, card=c)
        set_invoice_paid(e.installments.get(number=1).invoice, True)
        e.installments_count = 2
        e.save()
        generate_installments(e)
        self.assertEqual(e.installments.count(), 2)
        self.assertTrue(e.installments.get(number=1).paid)
        self.assertEqual(Invoice.objects.filter(card=c).count(), 2)

    def test_pay_invoice_marks_installments(self):
        c = card(self.user)
        expense(self.user, "100", date(2026, 10, 3), "credito", 1, card=c)
        expense(self.user, "50", date(2026, 10, 4), "credito", 1, card=c)
        invoice = Invoice.objects.get(card=c)
        self.assertEqual(invoice.total, Decimal("150"))
        set_invoice_paid(invoice, True)
        self.assertFalse(invoice.installments.filter(paid=False).exists())
