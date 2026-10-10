from datetime import date

from django.test import TestCase
from rest_framework.test import APIClient

from finance.models import Category, Expense

from .factories import card, expense, make_user


class ApiTests(TestCase):
    def setUp(self):
        self.user = make_user()
        self.other = make_user("outro")
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_requires_login(self):
        self.assertEqual(APIClient().get("/api/expenses/").status_code, 403)
        self.assertEqual(self.client.get("/").status_code, 302)

    def test_new_user_gets_default_configuration(self):
        self.assertEqual(Category.objects.filter(user=self.user).count(), 26)

    def test_create_credit_purchase(self):
        c = card(self.user)
        cat = Category.objects.get(user=self.user, name="Lazer e viagens")
        r = self.client.post("/api/expenses/", {
            "description": "Show", "date": "2026-10-06", "total_amount": "300.00",
            "installments_count": 3, "payment_method": "credito", "card": c.id, "category": cat.id,
        }, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual([i["competence"] for i in r.json()["installments"]],
                         ["2026-11-01", "2026-12-01", "2027-01-01"])

    def test_credit_requires_card(self):
        cat = Category.objects.get(user=self.user, name="Lazer e viagens")
        r = self.client.post("/api/expenses/", {
            "description": "X", "date": "2026-10-06", "total_amount": "10",
            "payment_method": "credito", "category": cat.id,
        }, format="json")
        self.assertEqual(r.status_code, 400)

    def test_cannot_use_other_users_category_or_see_their_data(self):
        foreign = Category.objects.filter(user=self.other).first()
        r = self.client.post("/api/expenses/", {
            "description": "X", "date": "2026-10-06", "total_amount": "10",
            "payment_method": "pix", "category": foreign.id,
        }, format="json")
        self.assertEqual(r.status_code, 400)
        expense(self.other, "99")
        self.assertEqual(self.client.get("/api/installments/").data["count"], 0)

    def test_installment_filters_and_totals(self):
        c = card(self.user)
        expense(self.user, "100", date(2026, 10, 3), "pix")
        expense(self.user, "200", date(2026, 10, 3), "credito", 2, card=c,
                category=Category.objects.get(user=self.user, name="Lazer e viagens"))
        r = self.client.get("/api/installments/", {"month": "2026-10", "payment_method": "credito"})
        self.assertEqual(r.data["count"], 1)
        self.assertEqual(r.data["totals"]["total"], 100)
        r = self.client.get("/api/installments/", {"search": "compra", "month_from": "2026-11"})
        self.assertEqual(r.data["count"], 1)
        csv = self.client.get("/api/installments/export/")
        self.assertEqual(csv.status_code, 200)

    def test_export_neutralizes_formulas(self):
        expense(self.user, description='=HYPERLINK("http://x","clique")')
        body = self.client.get("/api/installments/export/").content.decode()
        self.assertIn("'=HYPERLINK", body)
        self.assertNotIn(';=HYPERLINK', body)
        self.assertNotIn(';"=HYPERLINK', body)

    def test_dashboard_and_projection(self):
        self.assertEqual(self.client.get("/api/dashboard/", {"month": "2026-10"}).status_code, 200)
        r = self.client.get("/api/projection/", {"months": 6})
        self.assertEqual(len(r.data["months"]), 6)

    def test_card_preview_and_pay_invoice(self):
        c = card(self.user, closing_day=28, due_day=5)
        r = self.client.get(f"/api/cards/{c.id}/preview/", {"date": "2026-10-27"})
        self.assertEqual(str(r.data["competence"]), "2026-11-01")
        e = expense(self.user, "100", date(2026, 10, 27), "credito", card=c)
        invoice_id = e.installments.get().invoice_id
        self.assertTrue(self.client.post(f"/api/invoices/{invoice_id}/pay/").data["paid"])
        self.assertTrue(Expense.objects.get(pk=e.pk).installments.get().paid)

    def test_delete_category_in_use_returns_conflict(self):
        e = expense(self.user, "10")
        self.assertEqual(self.client.delete(f"/api/categories/{e.category_id}/").status_code, 409)

    def test_card_color_accepts_hex_and_rejects_invalid(self):
        base = {"name": "C6", "closing_day": 1, "due_day": 10, "limit": "1000"}
        r = self.client.post("/api/cards/", {**base, "color": "1A2b3C"}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["color"], "#1a2b3c")
        r = self.client.post("/api/cards/", {**base, "color": "#F0a"}, format="json")
        self.assertEqual(r.data["color"], "#ff00aa")
        r = self.client.post("/api/cards/", {**base, "color": "red;background:url(x)"}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("color", r.data)

    def test_optional_text_fields_accept_null(self):
        r = self.client.post("/api/cards/", {
            "name": "XP", "brand": None, "closing_day": 20, "due_day": 27, "limit": "0", "color": "#1e293b",
        }, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["brand"], "")

    def test_nature_and_block_follow_category(self):
        cat = Category.objects.get(user=self.user, name="Mercado")
        r = self.client.post("/api/expenses/", {
            "description": "Feira", "date": "2026-10-06", "total_amount": "50", "payment_method": "pix",
            "category": cat.id, "nature": 999, "block": 999,  # ignorados: derivados do grupo
        }, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual((r.data["nature_name"], r.data["block_name"]), ("Essencial variável", "Essenciais"))
        lazer = Category.objects.get(user=self.user, name="Lazer e viagens")
        r = self.client.patch(f"/api/expenses/{r.data['id']}/", {"category": lazer.id}, format="json")
        self.assertEqual((r.data["nature_name"], r.data["block_name"]), ("Discricionário", "Estilo de vida"))
        inst = self.client.get("/api/installments/", {"block": lazer.nature.block_id}).data
        self.assertEqual(inst["count"], 1)
