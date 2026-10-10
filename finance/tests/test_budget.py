from datetime import date
from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase

from finance.models import Block, Expense, MonthPlan, RecurringExpense
from finance.services import budget
from finance.services.recurring import materialize

from .factories import card, category, expense, make_user, salary

TODAY = date(2026, 10, 10)
PATCHES = [
    "finance.services.installments.today",
    "finance.services.recurring.today",
    "finance.services.budget.today",
]


class BudgetTests(TestCase):
    def setUp(self):
        self.patchers = [patch(p, lambda: TODAY) for p in PATCHES]
        for p in self.patchers:
            p.start()
        self.user = make_user()
        salary(self.user)

    def tearDown(self):
        for p in self.patchers:
            p.stop()

    def blocks(self, summary):
        return {b["name"]: b for b in summary["blocks"]}

    def test_default_blocks_split_expected_income(self):
        summary = budget.month_summary(self.user, date(2026, 10, 1))
        self.assertEqual(summary["expected_income"], Decimal("6000"))
        blocks = self.blocks(summary)
        self.assertEqual(blocks["Essenciais"]["budget"], Decimal("3000"))
        self.assertEqual(blocks["Estilo de vida"]["budget"], Decimal("1800"))
        self.assertEqual(blocks["Prioridades financeiras"]["budget"], Decimal("1200"))

    def test_month_plan_overrides_expected_income(self):
        MonthPlan.objects.create(user=self.user, competence=date(2026, 10, 1), expected_income=Decimal("7000"))
        self.assertEqual(budget.expected_income(self.user, date(2026, 10, 1)), Decimal("7000"))

    def test_credit_counts_in_invoice_month(self):
        c = card(self.user, closing_day=5, due_day=12)
        expense(self.user, "200", date(2026, 10, 6), "credito", 2, card=c)  # alimentação -> pessoais
        expense(self.user, "1500", date(2026, 10, 1), "pix", category=category(self.user, "Moradia"))
        october = self.blocks(budget.month_summary(self.user, date(2026, 10, 1)))
        november = self.blocks(budget.month_summary(self.user, date(2026, 11, 1)))
        self.assertEqual(october["Estilo de vida"]["used"], Decimal("0"))
        self.assertEqual(october["Essenciais"]["used"], Decimal("1500"))
        self.assertEqual(october["Essenciais"]["remaining"], Decimal("1500"))
        self.assertEqual(november["Estilo de vida"]["used"], Decimal("100"))

    def test_recurring_materialize_is_idempotent_and_projects_future(self):
        RecurringExpense.objects.create(
            user=self.user, description="Aluguel", amount=Decimal("1500"),
            category=category(self.user, "Moradia"), payment_method="boleto", day=10,
            start_month=date(2026, 9, 1),
        )
        materialize(self.user)
        materialize(self.user)
        self.assertEqual(Expense.objects.filter(kind=Expense.RECURRING).count(), 2)  # set e out
        proj = budget.projection(self.user, months=3)["months"]
        self.assertEqual([m["committed"] for m in proj], [Decimal("1500")] * 3)
        self.assertEqual(proj[0]["free"], Decimal("4500"))

    def test_fixed_block(self):
        Block.objects.filter(user=self.user, name="Prioridades financeiras").update(kind="fixed", value=800)
        blocks = self.blocks(budget.month_summary(self.user, date(2026, 10, 1)))
        self.assertEqual(blocks["Prioridades financeiras"]["budget"], Decimal("800"))

    def test_debts_summary(self):
        e = expense(self.user, "1000", date(2026, 9, 1), "boleto", 4, kind=Expense.DEBT,
                    category=category(self.user, "Empréstimos e financiamentos"))
        e.installments.filter(number=1).update(paid=True)
        debt = budget.debts_summary(self.user)[0]
        self.assertEqual(debt["remaining"], Decimal("750"))
        self.assertEqual(debt["paid_count"], 1)

    def test_yearly_subscription_only_charges_on_anniversary(self):
        RecurringExpense.objects.create(
            user=self.user, kind=RecurringExpense.SUBSCRIPTION, frequency=RecurringExpense.YEARLY,
            description="Anuidade", amount=Decimal("240"), category=category(self.user, "Juros e tarifas"),
            payment_method="pix", day=20, start_month=date(2026, 3, 1),
        )
        materialize(self.user)
        self.assertEqual(Expense.objects.filter(kind=Expense.RECURRING).count(), 1)  # mar/2026
        proj = budget.projection(self.user, months=12)["months"]
        charged = [m["month"] for m in proj if m["committed"]]
        self.assertEqual(charged, [date(2027, 3, 1)])
        summary = budget.month_summary(self.user, date(2026, 10, 1))["subscriptions"]
        self.assertEqual(summary, {"count": 1, "monthly": Decimal("20.00")})

    def test_next_charge(self):
        from finance.services.recurring import next_charge

        sub = RecurringExpense(
            user=self.user, frequency="mensal", amount=Decimal("45.90"), day=5,
            start_month=date(2026, 1, 1), active=True,
        )
        self.assertEqual(next_charge(sub), date(2026, 11, 5))  # dia 5 já passou em 10/10
        sub.day = 15
        self.assertEqual(next_charge(sub), date(2026, 10, 15))
