from datetime import date
from types import SimpleNamespace

from django.test import SimpleTestCase

from finance.services.billing import cycle_for_competence, invoice_cycle


def card(closing, due):
    return SimpleNamespace(closing_day=closing, due_day=due)


class InvoiceCycleTests(SimpleTestCase):
    def test_purchase_before_closing_goes_to_current_invoice(self):
        self.assertEqual(
            invoice_cycle(card(5, 12), date(2026, 10, 3)),
            (date(2026, 10, 1), date(2026, 10, 5), date(2026, 10, 12)),
        )

    def test_purchase_on_closing_day_goes_to_next_invoice(self):
        self.assertEqual(invoice_cycle(card(5, 12), date(2026, 10, 5))[0], date(2026, 11, 1))

    def test_purchase_after_closing_goes_to_next_invoice(self):
        self.assertEqual(invoice_cycle(card(5, 12), date(2026, 10, 6))[0], date(2026, 11, 1))

    def test_due_day_before_closing_day_is_due_next_month(self):
        competence, closing, due = invoice_cycle(card(28, 5), date(2026, 10, 27))
        self.assertEqual((competence, closing, due), (date(2026, 11, 1), date(2026, 10, 28), date(2026, 11, 5)))

    def test_year_rollover(self):
        self.assertEqual(invoice_cycle(card(28, 5), date(2026, 12, 29))[0], date(2027, 2, 1))

    def test_closing_day_31_in_february_is_clamped(self):
        competence, closing, due = invoice_cycle(card(31, 10), date(2026, 2, 27))
        self.assertEqual(closing, date(2026, 2, 28))
        self.assertEqual(due, date(2026, 3, 10))
        self.assertEqual(invoice_cycle(card(31, 10), date(2026, 2, 28))[0], date(2026, 4, 1))

    def test_cycle_for_competence_matches_invoice_cycle(self):
        c = card(28, 5)
        competence, closing, due = invoice_cycle(c, date(2026, 10, 27))
        self.assertEqual(cycle_for_competence(c, competence), (closing, due))
