from datetime import date
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from finance.models import Category, Goal, Investment, InvestmentMovement, MonthPlan, UserSettings

from .factories import make_user

TODAY = date(2026, 10, 10)


class SettingsApiTests(TestCase):
    def setUp(self):
        self.user = make_user()
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_new_user_has_pending_onboarding(self):
        data = self.client.get("/api/settings/").data
        self.assertEqual(data["installment_ceiling_pct"], Decimal("30"))
        self.assertTrue(data["onboarding_pending"])
        self.assertTrue(self.client.get("/api/meta/").data["onboarding_pending"])

    def test_settings_created_on_demand(self):
        UserSettings.objects.filter(user=self.user).delete()
        self.assertEqual(self.client.get("/api/settings/").status_code, 200)

    def test_update_ceiling_validates_range(self):
        r = self.client.patch("/api/settings/", {"installment_ceiling_pct": "25"}, format="json")
        self.assertEqual(r.data["installment_ceiling_pct"], Decimal("25"))
        for bad in ("-1", "101"):
            with self.subTest(value=bad):
                r = self.client.patch("/api/settings/", {"installment_ceiling_pct": bad}, format="json")
                self.assertEqual(r.status_code, 400)

    def test_onboarding_flow(self):
        self.assertFalse(self.client.post("/api/settings/onboarding/skip/").data["onboarding_pending"])
        self.assertTrue(self.client.post("/api/settings/onboarding/reset/").data["onboarding_pending"])
        data = self.client.post("/api/settings/onboarding/complete/").data
        self.assertIsNotNone(data["onboarding_completed_at"])
        self.assertFalse(self.client.get("/api/meta/").data["onboarding_pending"])
        self.assertEqual(self.client.post("/api/settings/onboarding/x/").status_code, 404)

    def test_onboarding_dates_are_read_only_on_patch(self):
        self.client.patch("/api/settings/", {"onboarding_completed_at": "2026-01-01T00:00:00Z"}, format="json")
        self.assertTrue(self.client.get("/api/settings/").data["onboarding_pending"])


class ExpensePreviewCommitmentTests(TestCase):
    def setUp(self):
        self.user = make_user()
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        for month in (10, 11):
            MonthPlan.objects.create(user=self.user, competence=date(2026, month, 1), expected_income=Decimal("1000"))
        self.category = Category.objects.get(user=self.user, name="Vestuário").id

    def preview(self, **data):
        body = {"description": "X", "date": "2026-10-03", "payment_method": "pix", "category": self.category, **data}
        return self.client.post("/api/expenses/preview/", body, format="json").data["commitment"]

    def test_warns_per_affected_month(self):
        rows = self.preview(total_amount="800", installments_count=2)
        self.assertEqual([r["month"] for r in rows], [date(2026, 10, 1), date(2026, 11, 1)])
        self.assertEqual((rows[0]["status"], rows[0]["excess"]), ("over", Decimal("100.00")))

    def test_single_payment_has_no_commitment(self):
        self.assertEqual(self.preview(total_amount="800"), [])

    def test_editing_does_not_double_count(self):
        r = self.client.post("/api/expenses/", {
            "description": "X", "date": "2026-10-03", "payment_method": "pix", "category": self.category,
            "total_amount": "400", "installments_count": 2,
        }, format="json")
        rows = self.preview(id=r.data["id"], total_amount="400", installments_count=2)
        self.assertEqual(rows[0]["committed"], Decimal("200"))


class BackfillTests(TestCase):
    def test_signal_creates_settings(self):
        user = get_user_model().objects.create_user("novo", password="senha-forte-123")
        self.assertTrue(UserSettings.objects.filter(user=user).exists())
