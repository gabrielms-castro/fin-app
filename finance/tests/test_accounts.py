from django.contrib.auth import get_user_model
from django.test import TestCase

from .factories import make_user


class AdminTests(TestCase):
    def setUp(self):
        self.admin = get_user_model().objects.create_superuser("admin", password="senha-forte-123")
        self.user = make_user()

    def test_admin_manages_only_user_accounts(self):
        self.client.force_login(self.admin)
        self.assertEqual(self.client.get("/admin/auth/user/add/").status_code, 200)
        self.assertEqual(self.client.get("/admin/finance/").status_code, 404)

    def test_regular_user_has_no_admin_access(self):
        self.client.force_login(self.user)
        self.assertEqual(self.client.get("/admin/").status_code, 302)


class PasswordChangeTests(TestCase):
    def setUp(self):
        self.user = make_user()

    def test_requires_login(self):
        self.assertRedirects(self.client.get("/senha/"), "/login/?next=/senha/")

    def test_change_password_keeps_session(self):
        self.client.force_login(self.user)
        self.assertEqual(self.client.get("/senha/").status_code, 200)
        r = self.client.post("/senha/", {
            "old_password": "senha-forte-123", "new_password1": "outra-senha-456", "new_password2": "outra-senha-456",
        })
        self.assertRedirects(r, "/senha/ok/")
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("outra-senha-456"))
        self.assertEqual(self.client.get("/").status_code, 200)
