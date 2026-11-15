from datetime import date
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from finance.models import Category, Expense, Goal, GoalMovement, Investment, InvestmentMovement
from finance.services import budget
from finance.services.goals import goal_saved
from finance.services.surplus import free_balance

from .factories import expense, make_user
from .test_surplus import OCT, PatchedTodayMixin

D = Decimal


class GoalMovementTests(PatchedTodayMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.goal = Goal.objects.create(user=self.user, name="Reserva de emergência", target_amount=D("10000"))

    def move(self, kind, amount, goal=None, when="2026-10-08", **extra):
        goal = goal or self.goal
        return self.client.post(
            f"/api/goals/{goal.id}/move/", {"kind": kind, "amount": amount, "date": when, **extra}, format="json"
        )

    def available(self):
        return free_balance(self.user, OCT)["available"]

    def fund(self, received="6000", spent="1000"):
        self.receive(received)
        expense(self.user, spent, date(2026, 10, 3))  # disponível em outubro: received − spent

    def test_deposit_needs_free_balance(self):
        r = self.move("aporte", "500")
        self.assertEqual(r.status_code, 400)
        self.assertIn("Saldo livre insuficiente", str(r.data["amount"]))
        self.assertIn("Receitas", str(r.data["amount"]))
        self.assertFalse(GoalMovement.objects.exists())
        self.assertFalse(Expense.objects.filter(kind=Expense.GOAL).exists())

    def test_deposit_cannot_exceed_available(self):
        self.fund()
        r = self.move("aporte", "5000.01")
        self.assertEqual(r.status_code, 400)
        self.assertIn("R$ 5.000,00", str(r.data["amount"]))
        self.assertEqual(self.move("aporte", "5000").status_code, 201)

    def test_deposit_counts_as_paid_expense_and_moves_progress(self):
        self.fund()
        r = self.move("aporte", "800", notes="novembro")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(D(r.data["saved"]), D("800"))
        movement = GoalMovement.objects.get()
        exp = movement.expense
        self.assertEqual((exp.kind, exp.total_amount, exp.date), (Expense.GOAL, D("800"), date(2026, 10, 8)))
        self.assertEqual(exp.category.scope, Category.INVESTMENT)
        self.assertTrue(all(i.paid for i in exp.installments.all()))
        self.assertEqual(budget.month_summary(self.user, OCT)["spent"], D("1800"))
        self.assertEqual(self.available(), D("4200"))

    def test_uses_goal_category_when_set(self):
        self.fund()
        invest = Category.objects.get(user=self.user, name="Investimentos")
        self.goal.category = invest
        self.goal.save()
        self.move("aporte", "100")
        self.assertEqual(GoalMovement.objects.get().expense.category, invest)

    def test_category_must_be_investment_scope(self):
        other = Category.objects.filter(user=self.user, scope=Category.EXPENSE).first()
        r = self.client.patch(f"/api/goals/{self.goal.id}/", {"category": other.id}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_withdrawal_lowers_progress_and_returns_money(self):
        self.fund()
        self.move("aporte", "1000")
        r = self.move("retirada", "1000.01")
        self.assertEqual(r.status_code, 400)
        self.assertIn("guardado na meta", str(r.data["amount"]))
        r = self.move("retirada", "300")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(D(r.data["saved"]), D("700"))
        fb = free_balance(self.user, OCT)
        self.assertEqual(fb["redeemed"], D("300"))
        self.assertEqual(fb["available"], D("4300"))  # 6000 − 1000 − 1000 + 300
        self.assertIsNone(GoalMovement.objects.get(kind="retirada").expense)

    def test_empty_notes_from_form_are_accepted(self):
        self.goal.initial_amount = D("100")
        self.goal.save()
        self.assertEqual(self.move("retirada", "50", notes=None).status_code, 201)
        self.assertEqual(GoalMovement.objects.get().notes, "")

    def test_withdrawal_can_use_initial_amount(self):
        self.goal.initial_amount = D("2000")
        self.goal.save()
        self.assertEqual(self.move("retirada", "2000").status_code, 201)
        self.assertEqual(goal_saved(self.goal), D("0"))

    def test_history_and_delete_deposit_removes_expense(self):
        self.fund()
        self.move("aporte", "500")
        rows = self.client.get("/api/goal-movements/", {"goal": self.goal.id}).data
        self.assertEqual([(r["kind"], D(r["amount"])) for r in rows], [("aporte", D("500"))])
        self.assertEqual(self.client.delete(f"/api/goal-movements/{rows[0]['id']}/").status_code, 204)
        self.assertFalse(Expense.objects.filter(kind=Expense.GOAL).exists())
        self.assertEqual(goal_saved(self.goal), D("0"))
        self.assertEqual(self.available(), D("5000"))

    def test_goal_expense_is_managed_only_in_goals(self):
        self.fund()
        self.move("aporte", "500")
        exp = Expense.objects.get(kind=Expense.GOAL)
        r = self.client.patch(f"/api/expenses/{exp.id}/", {"description": "x"}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.client.delete(f"/api/expenses/{exp.id}/").status_code, 400)
        r = self.client.post("/api/expenses/", {
            "kind": "meta", "description": "x", "date": "2026-10-08", "total_amount": "10",
            "payment_method": "pix", "category": exp.category_id,
        }, format="json")
        self.assertEqual(r.status_code, 400)

    def test_deleting_goal_deletes_its_expenses(self):
        self.fund()
        self.move("aporte", "500")
        self.assertEqual(self.client.delete(f"/api/goals/{self.goal.id}/").status_code, 204)
        self.assertFalse(Expense.objects.filter(kind=Expense.GOAL).exists())

    def test_archived_goal_cannot_move(self):
        self.fund()
        self.goal.active = False
        self.goal.save()
        self.assertEqual(self.move("aporte", "100").status_code, 400)

    def test_goal_linked_to_investment_moves_the_investment(self):
        self.fund()
        investment = Investment.objects.create(
            user=self.user, name="CDB", category=Category.objects.get(user=self.user, name="Investimentos"),
        )
        self.goal.investment = investment
        self.goal.save()
        r = self.move("aporte", "1000")
        self.assertEqual((r.status_code, D(r.data["saved"])), (201, D("1000")))
        deposit = InvestmentMovement.objects.get()
        self.assertEqual(deposit.expense.kind, Expense.INVESTMENT)
        self.assertEqual(self.move("retirada", "400").status_code, 201)
        self.assertEqual(D(self.client.get(f"/api/goals/{self.goal.id}/").data["saved"]), D("600"))
        self.assertFalse(GoalMovement.objects.exists())
        self.assertEqual(free_balance(self.user, OCT)["redeemed"], D("400"))

    def test_free_balance_endpoint(self):
        self.fund()
        data = self.client.get("/api/free-balance/", {"month": "2026-10"}).data
        self.assertEqual(D(data["available"]), D("5000"))

    def test_isolation(self):
        self.fund()
        self.move("aporte", "500")
        other = APIClient()
        other.force_authenticate(make_user("outro"))
        self.assertEqual(self.move("aporte", "1").status_code, 201)
        self.assertEqual(other.post(f"/api/goals/{self.goal.id}/move/", {"kind": "aporte", "amount": "1"}, format="json").status_code, 404)
        self.assertEqual(other.get("/api/goal-movements/").data, [])
        movement = GoalMovement.objects.first()
        self.assertEqual(other.delete(f"/api/goal-movements/{movement.id}/").status_code, 404)
