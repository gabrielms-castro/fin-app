from datetime import date
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from finance.models import (
    Block,
    Category,
    Income,
    Investment,
    InvestmentMovement,
    MonthPlan,
    Nature,
    RecurringExpense,
)
from finance.services.investments import sync_expense

from .factories import card, category, expense, make_user, salary


class IsolationTests(TestCase):
    """Um usuário nunca vê nem altera recursos de outro."""

    def setUp(self):
        self.owner = make_user("dono")
        self.intruder = make_user("intruso")
        self.client = APIClient()
        self.client.force_authenticate(self.intruder)

        o = self.owner
        self.card = card(o)
        self.expense = expense(o, "300", date(2026, 10, 3), "credito", 3, card=self.card)
        self.installment = self.expense.installments.first()
        self.invoice = self.installment.invoice
        self.recurring = RecurringExpense.objects.create(
            user=o, description="Netflix", amount=Decimal("40"), category=category(o),
            payment_method="pix", start_month=date(2026, 1, 1),
        )
        self.source = salary(o)
        self.income = Income.objects.create(user=o, date=date(2026, 10, 5), amount=Decimal("6000"), description="Salário")
        self.plan = MonthPlan.objects.create(user=o, competence=date(2026, 10, 1), expected_income=Decimal("7000"))
        self.investment = Investment.objects.create(
            user=o, name="CDB", category=Category.objects.get(user=o, name="Investimentos"),
        )
        self.movement = InvestmentMovement.objects.create(
            user=o, investment=self.investment, kind="aporte", date=date(2026, 10, 6), amount=Decimal("500"),
        )
        sync_expense(self.movement)

        self.resources = {
            "cards": self.card, "expenses": self.expense, "installments": self.installment,
            "invoices": self.invoice, "recurring": self.recurring, "income-sources": self.source,
            "incomes": self.income, "month-plans": self.plan, "investments": self.investment,
            "investment-movements": self.movement, "categories": category(o),
            "natures": Nature.objects.filter(user=o).first(), "blocks": Block.objects.filter(user=o).first(),
        }
        self.read_only = {"installments", "invoices"}

    def ids(self, response):
        data = response.data
        rows = data["results"] if isinstance(data, dict) else data
        return {row["id"] for row in rows}

    def test_cannot_read_change_or_delete_others_resources(self):
        for route, obj in self.resources.items():
            with self.subTest(route=route):
                url = f"/api/{route}/{obj.pk}/"
                self.assertEqual(self.client.get(url).status_code, 404)
                self.assertNotIn(obj.pk, self.ids(self.client.get(f"/api/{route}/")))
                expected = 405 if route in self.read_only else 404
                self.assertEqual(self.client.patch(url, {}, format="json").status_code, expected)
                self.assertEqual(self.client.delete(url).status_code, expected)
                self.assertTrue(type(obj).objects.filter(pk=obj.pk).exists())

    def test_cannot_run_actions_on_others_resources(self):
        calls = [
            ("get", f"/api/cards/{self.card.pk}/preview/", {}),
            ("post", f"/api/invoices/{self.invoice.pk}/pay/", {}),
            ("post", f"/api/installments/{self.installment.pk}/pay/", {"paid": True}),
            ("post", f"/api/investments/{self.investment.pk}/balance/", {"value": "1000"}),
        ]
        for method, url, data in calls:
            with self.subTest(url=url):
                self.assertEqual(getattr(self.client, method)(url, data, format="json").status_code, 404)
        self.installment.refresh_from_db()
        self.invoice.refresh_from_db()
        self.assertFalse(self.installment.paid or self.invoice.paid)
        self.assertEqual(self.investment.movements.count(), 1)

    def test_dashboard_and_projection_ignore_others_data(self):
        dash = self.client.get("/api/dashboard/", {"month": "2026-10"}).data
        self.assertEqual((dash["spent"], dash["received"], dash["expected_income"]), (0, 0, 0))
        self.assertEqual((dash["invoices"], dash["debts"], dash["by_category"]), ([], [], []))
        months = self.client.get("/api/projection/", {"months": 3, "start": "2026-10"}).data["months"]
        self.assertTrue(all(m["committed"] == 0 and not m["cards"] for m in months))

    def test_cannot_reference_others_resources(self):
        mine = category(self.intruder)
        attempts = [
            ("/api/expenses/", {
                "description": "X", "date": "2026-10-06", "total_amount": "10",
                "payment_method": "credito", "card": self.card.pk, "category": mine.pk,
            }),
            ("/api/incomes/", {"date": "2026-10-06", "amount": "10", "description": "X", "source": self.source.pk}),
            ("/api/investment-movements/", {
                "investment": self.investment.pk, "kind": "aporte", "date": "2026-10-06", "amount": "10",
            }),
        ]
        for url, data in attempts:
            with self.subTest(url=url):
                self.assertEqual(self.client.post(url, data, format="json").status_code, 400)

