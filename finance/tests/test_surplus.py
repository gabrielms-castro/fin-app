from datetime import date
from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from finance.models import (
    Category,
    Expense,
    Goal,
    Income,
    IncomeSource,
    Investment,
    InvestmentMovement,
    MonthPlan,
    SurplusAllocation,
)
from finance.services import budget
from finance.services.goals import goal_progress
from finance.services.investments import balance, sync_expense
from finance.services.surplus import free_balance

from .factories import expense, make_user, salary

TODAY = date(2026, 10, 10)
PATCHES = [
    "finance.services.installments.today",
    "finance.services.recurring.today",
    "finance.services.budget.today",
    "finance.services.surplus.today",
]
OCT, NOV, DEC = date(2026, 10, 1), date(2026, 11, 1), date(2026, 12, 1)
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


class FreeBalanceTests(PatchedTodayMixin, TestCase):
    def test_no_income_is_all_zero(self):
        expense(self.user, "100", date(2026, 10, 3))
        fb = free_balance(self.user, OCT)
        self.assertEqual((fb["carry_in"], fb["available"], fb["spent"]), (0, 0, 0))

    def test_single_month(self):
        self.receive("6000")
        expense(self.user, "1500", date(2026, 10, 3))
        fb = free_balance(self.user, OCT)
        self.assertEqual(fb["carry_in"], 0)
        self.assertEqual(fb["available"], D("4500"))

    def test_positive_surplus_rolls_to_next_month(self):
        self.receive("6000")
        expense(self.user, "1500", date(2026, 10, 3))
        self.receive("6000", date(2026, 11, 5))
        expense(self.user, "7000", date(2026, 11, 3))
        nov = free_balance(self.user, NOV)
        self.assertEqual(nov["carry_in"], D("4500"))
        self.assertEqual(nov["available"], D("3500"))

    def test_negative_balance_also_rolls(self):
        self.receive("1000")
        expense(self.user, "1500", date(2026, 10, 3))
        nov = free_balance(self.user, NOV)
        self.assertEqual(nov["carry_in"], D("-500"))
        self.assertEqual(nov["available"], D("-500"))

    def test_editing_past_month_recalculates_following(self):
        self.receive("6000")
        purchase = expense(self.user, "1500", date(2026, 10, 3))
        self.assertEqual(free_balance(self.user, DEC)["carry_in"], D("4500"))
        purchase.delete()
        self.assertEqual(free_balance(self.user, DEC)["carry_in"], D("6000"))

    def test_carry_does_not_change_block_budgets(self):
        self.receive("6000")
        self.receive("6000", date(2026, 11, 5))
        summary = budget.month_summary(self.user, NOV)
        self.assertEqual(summary["free_balance"]["carry_in"], D("6000"))
        self.assertEqual(summary["budget_base"], D("6000"))
        self.assertEqual(sum(b["budget"] for b in summary["blocks"]), D("6000"))

    def test_invariant_matches_totals(self):
        self.receive("6000")
        self.receive("6100", date(2026, 11, 5))
        expense(self.user, "900", date(2026, 10, 3), count=3)
        SurplusAllocation.objects.create(user=self.user, competence=NOV, amount=D("250"))
        fb = free_balance(self.user, DEC)
        self.assertEqual(fb["available"], D("6000") + D("6100") - D("900") - D("250"))


class AllocationApiTests(PatchedTodayMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.receive("6000")
        expense(self.user, "1000", date(2026, 10, 3))  # disponível em outubro: 5000
        self.investment = Investment.objects.create(
            user=self.user, name="CDB", category=Category.objects.get(user=self.user, name="Investimentos"),
        )

    def post(self, **data):
        return self.client.post("/api/surplus-allocations/", {"competence": "2026-10-01", **data}, format="json")

    def available(self):
        return free_balance(self.user, OCT)["available"]

    def test_requires_exactly_one_destination(self):
        goal = Goal.objects.create(user=self.user, name="Viagem", target_amount=D("5000"))
        self.assertEqual(self.post(amount="10").status_code, 400)
        self.assertEqual(self.post(amount="10", goal=goal.id, investment=self.investment.id).status_code, 400)

    def test_cannot_allocate_more_than_available(self):
        r = self.post(amount="5000.01", investment=self.investment.id)
        self.assertEqual(r.status_code, 400)
        self.assertIn("amount", r.data)

    def test_investment_destination_creates_deposit_without_expense(self):
        r = self.post(amount="800", investment=self.investment.id)
        self.assertEqual(r.status_code, 201, r.data)
        movement = InvestmentMovement.objects.get(investment=self.investment)
        self.assertIsNone(movement.expense)
        self.assertEqual(balance(self.investment), D("800"))
        self.assertEqual(self.available(), D("4200"))
        # Não conta como gasto do mês nem consome bloco.
        self.assertEqual(budget.month_summary(self.user, OCT)["spent"], D("1000"))
        self.assertFalse(Expense.objects.filter(kind=Expense.INVESTMENT).exists())

    def test_goal_without_investment_progress_includes_allocation(self):
        goal = Goal.objects.create(user=self.user, name="Viagem", target_amount=D("5000"), initial_amount=D("200"))
        self.assertEqual(self.post(amount="300", goal=goal.id).status_code, 201)
        self.assertEqual(goal_progress(goal)["saved"], D("500"))
        self.assertFalse(InvestmentMovement.objects.exists())

    def test_goal_with_investment_deposits_into_it(self):
        goal = Goal.objects.create(user=self.user, name="Reserva", target_amount=D("5000"), investment=self.investment)
        self.assertEqual(self.post(amount="400", goal=goal.id).status_code, 201)
        self.assertEqual(goal_progress(goal)["saved"], D("400"))
        allocation = SurplusAllocation.objects.get()
        self.assertEqual(allocation.movement.investment, self.investment)

    def test_delete_removes_deposit_and_returns_money(self):
        allocation_id = self.post(amount="800", investment=self.investment.id).data["id"]
        self.assertEqual(self.client.delete(f"/api/surplus-allocations/{allocation_id}/").status_code, 204)
        self.assertFalse(InvestmentMovement.objects.exists())
        self.assertEqual(self.available(), D("5000"))

    def test_no_edit_endpoint(self):
        allocation_id = self.post(amount="800", investment=self.investment.id).data["id"]
        r = self.client.patch(f"/api/surplus-allocations/{allocation_id}/", {"amount": "1"}, format="json")
        self.assertEqual(r.status_code, 405)

    def test_surplus_deposit_cannot_be_edited_in_investments_and_never_becomes_expense(self):
        self.post(amount="800", investment=self.investment.id)
        movement = InvestmentMovement.objects.get()
        r = self.client.patch(f"/api/investment-movements/{movement.id}/", {"amount": "900"}, format="json")
        self.assertEqual(r.status_code, 400)
        # Editar o investimento ressincroniza os aportes: o da sobra continua sem lançamento.
        self.client.patch(f"/api/investments/{self.investment.id}/", {"name": "CDB 2"}, format="json")
        sync_expense(movement)
        movement.refresh_from_db()
        self.assertIsNone(movement.expense)

    def test_dashboard_exposes_free_balance(self):
        data = self.client.get("/api/dashboard/", {"month": "2026-10"}).data
        self.assertEqual(data["free_balance"]["available"], D("5000"))
        self.assertEqual(data["budget_base"], D("6000"))

    def test_month_filter_and_isolation(self):
        self.post(amount="100", investment=self.investment.id)
        other = make_user("outro")
        other_client = APIClient()
        other_client.force_authenticate(other)
        self.assertEqual(other_client.get("/api/surplus-allocations/").data, [])
        allocation = SurplusAllocation.objects.get()
        self.assertEqual(other_client.delete(f"/api/surplus-allocations/{allocation.id}/").status_code, 404)
        # Não pode destinar para o investimento de outra pessoa.
        r = other_client.post("/api/surplus-allocations/", {
            "competence": "2026-10-01", "amount": "1", "investment": self.investment.id,
        }, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(len(self.client.get("/api/surplus-allocations/", {"month": "2026-10"}).data), 1)
        self.assertEqual(len(self.client.get("/api/surplus-allocations/", {"month": "2026-11"}).data), 0)
