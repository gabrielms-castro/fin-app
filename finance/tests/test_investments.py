from datetime import date
from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from finance.models import Category, Expense, Investment, InvestmentMovement
from finance.services import budget

from .factories import make_user, salary

TODAY = date(2026, 10, 10)


@patch("finance.services.installments.today", lambda: TODAY)
@patch("finance.services.recurring.today", lambda: TODAY)
@patch("finance.services.budget.today", lambda: TODAY)
class InvestmentTests(TestCase):
    def setUp(self):
        self.user = make_user()
        salary(self.user)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.reserve = Category.objects.get(user=self.user, name="Reserva de emergência")
        r = self.client.post("/api/investments/", {
            "name": "Reserva Nubank", "type": "reserva", "category": self.reserve.id,
            "goal": "18000", "monthly_target": "500", "color": "#10b981",
        }, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.inv = Investment.objects.get(pk=r.data["id"])

    def move(self, kind, amount, when="2026-10-05"):
        r = self.client.post("/api/investment-movements/", {
            "investment": self.inv.id, "kind": kind, "amount": amount, "date": when,
        }, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        return r.data

    def test_deposit_enters_budget_in_priority_block(self):
        self.move("aporte", "800")
        expense = Expense.objects.get(kind=Expense.INVESTMENT)
        self.assertTrue(expense.installments.get().paid)
        blocks = {b["name"]: b for b in budget.month_summary(self.user, date(2026, 10, 1))["blocks"]}
        prio = blocks["Prioridades financeiras"]
        self.assertEqual(prio["used"], Decimal("800"))
        self.assertEqual({n["name"]: n["total"] for n in prio["natures"]}["Patrimônio"], Decimal("800"))

    def test_withdrawal_and_yield_do_not_touch_budget(self):
        self.move("aporte", "1000")
        self.move("resgate", "200")
        self.move("rendimento", "15.50")
        self.assertEqual(Expense.objects.filter(kind=Expense.INVESTMENT).count(), 1)
        summary = budget.month_summary(self.user, date(2026, 10, 1))["investments"]
        self.assertEqual(summary["balance"], Decimal("815.50"))
        self.assertEqual(summary["month_deposits"], Decimal("1000"))
        self.assertEqual(summary["month_planned"], Decimal("500"))

    def test_set_balance_creates_yield(self):
        self.move("aporte", "1000")
        r = self.client.post(f"/api/investments/{self.inv.id}/balance/", {"value": "1012.34", "date": "2026-10-31"}, format="json")
        self.assertEqual(r.data["stats"]["balance"], Decimal("1012.34"))
        self.assertEqual(InvestmentMovement.objects.get(kind="rendimento").amount, Decimal("12.34"))

    def test_changing_deposit_kind_or_deleting_removes_expense(self):
        data = self.move("aporte", "300")
        r = self.client.patch(f"/api/investment-movements/{data['id']}/", {"kind": "resgate"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertFalse(Expense.objects.filter(kind=Expense.INVESTMENT).exists())
        data = self.move("aporte", "300")
        self.client.delete(f"/api/investment-movements/{data['id']}/")
        self.assertFalse(Expense.objects.filter(kind=Expense.INVESTMENT).exists())

    def test_investment_expense_cannot_be_edited_from_expenses(self):
        self.move("aporte", "300")
        expense = Expense.objects.get(kind=Expense.INVESTMENT)
        self.assertEqual(self.client.patch(f"/api/expenses/{expense.id}/", {"description": "x"}, format="json").status_code, 400)
        self.assertEqual(self.client.delete(f"/api/expenses/{expense.id}/").status_code, 400)

    def test_scopes_are_enforced(self):
        debt_cat = Category.objects.get(user=self.user, name="Empréstimos e financiamentos")
        market = Category.objects.get(user=self.user, name="Mercado")
        base = {"description": "X", "date": "2026-10-06", "total_amount": "10", "payment_method": "pix"}
        # lançamento comum não aceita grupo de dívida nem de investimento
        for cat in (debt_cat, self.reserve):
            r = self.client.post("/api/expenses/", {**base, "category": cat.id}, format="json")
            self.assertEqual(r.status_code, 400)
            self.assertIn("category", r.data)
        # dívida exige grupo de dívida
        r = self.client.post("/api/expenses/", {**base, "kind": "divida", "category": market.id}, format="json")
        self.assertEqual(r.status_code, 400)
        r = self.client.post("/api/expenses/", {**base, "kind": "divida", "category": debt_cat.id}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        # investimento exige grupo de investimento
        r = self.client.post("/api/investments/", {"name": "X", "category": market.id, "color": "#000"}, format="json")
        self.assertEqual(r.status_code, 400)
        # aporte não pode ser criado pela rota de lançamentos
        r = self.client.post("/api/expenses/", {**base, "kind": "investimento", "category": self.reserve.id}, format="json")
        self.assertEqual(r.status_code, 400)
