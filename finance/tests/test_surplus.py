from datetime import date
from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase

from finance.models import Income, IncomeSource, MonthPlan
from finance.services import budget

from .factories import make_user, salary

TODAY = date(2026, 10, 10)
PATCHES = [
    "finance.services.installments.today",
    "finance.services.recurring.today",
    "finance.services.budget.today",
]
OCT = date(2026, 10, 1)
D = Decimal


class PatchedTodayMixin:
    def setUp(self):
        self.patchers = [patch(p, lambda: TODAY) for p in PATCHES]
        for p in self.patchers:
            p.start()
        self.user = make_user()
        self.salary = salary(self.user)

    def tearDown(self):
        for p in self.patchers:
            p.stop()

    def receive(self, amount, when=date(2026, 10, 5), source="salary"):
        return Income.objects.create(
            user=self.user, date=when, amount=D(amount), description="Recebimento",
            source=self.salary if source == "salary" else source,
        )


class BudgetIncomeTests(PatchedTodayMixin, TestCase):
    def base(self, month=OCT):
        return budget.budget_income(self.user, month)["base"]

    def test_no_income_uses_expected(self):
        self.assertEqual(self.base(), D("6000"))

    def test_received_replaces_expected_of_the_source(self):
        self.receive("6259")
        self.assertEqual(self.base(), D("6259"))

    def test_pending_source_keeps_expected(self):
        IncomeSource.objects.create(user=self.user, name="Freela", amount=D("1000"), start_month=OCT)
        self.receive("6259")
        income = budget.budget_income(self.user, OCT)
        self.assertEqual(income["base"], D("7259"))
        self.assertEqual(income["pending_expected"], D("1000"))
        self.assertEqual(income["expected"], D("7000"))

    def test_received_less_shrinks_budget(self):
        self.receive("5800")
        self.assertEqual(self.base(), D("5800"))

    def test_income_without_source_adds_to_pending_expected(self):
        self.receive("300", source=None)
        self.assertEqual(self.base(), D("6300"))

    def test_month_plan_pending_is_what_is_left_of_the_plan(self):
        MonthPlan.objects.create(user=self.user, competence=OCT, expected_income=D("7000"))
        self.assertEqual(self.base(), D("7000"))
        self.receive("6259")
        # 7000 planejados − 6000 esperados do salário já recebido = 1000 ainda pendentes.
        self.assertEqual(self.base(), D("7259"))

    def test_summary_blocks_and_ceiling_use_the_base(self):
        self.receive("6259")
        summary = budget.month_summary(self.user, OCT)
        self.assertEqual(summary["expected_income"], D("6000"))
        self.assertEqual(summary["budget_base"], D("6259"))
        blocks = {b["name"]: b["budget"] for b in summary["blocks"]}
        self.assertEqual(blocks["Essenciais"], D("3129.50"))
        self.assertEqual(summary["installments_commitment"]["ceiling_amount"], D("1877.70"))

    def test_projection_uses_base_and_future_stays_expected(self):
        self.receive("6259")
        months = budget.projection(self.user, 2, OCT)["months"]
        self.assertEqual([m["expected_income"] for m in months], [D("6259"), D("6000")])
