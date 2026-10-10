from datetime import date
from decimal import Decimal

from django.test import TestCase

from finance.defaults import CATEGORIES, apply_default_structure
from finance.models import Block, Category, Expense, Nature

from .factories import make_user


class RestructureTests(TestCase):
    def setUp(self):
        self.user = make_user()
        # Simula a estrutura antiga (planilha original).
        Category.objects.filter(user=self.user).delete()
        Nature.objects.filter(user=self.user).delete()
        Block.objects.filter(user=self.user).delete()
        fixos = Block.objects.create(user=self.user, name="Gastos Fixos", value=60)
        pessoais = Block.objects.create(user=self.user, name="Gastos Pessoais", value=30)
        variavel = Nature.objects.create(user=self.user, name="Essencial variável", block=pessoais)
        Nature.objects.create(user=self.user, name="Essencial fixo", block=fixos)
        self.old = Category.objects.create(user=self.user, name="Alimentação", nature=variavel)
        self.custom = Category.objects.create(user=self.user, name="Meu grupo", nature=variavel)
        self.expense = Expense.objects.create(
            user=self.user, description="Mercado", date=date(2026, 10, 1), total_amount=Decimal("10"),
            payment_method="pix", category=self.old,
        )

    def test_restructure_renames_in_place_and_keeps_expenses(self):
        apply_default_structure(self.user)
        self.expense.refresh_from_db()
        self.assertEqual(self.expense.category.name, "Mercado")
        self.assertEqual(self.expense.category.nature.block.name, "Essenciais")
        self.assertEqual(
            list(Block.objects.filter(user=self.user).values_list("name", "value")),
            [("Essenciais", Decimal("50")), ("Estilo de vida", Decimal("30")), ("Prioridades financeiras", Decimal("20"))],
        )
        self.assertTrue(Category.objects.filter(pk=self.custom.pk).exists())
        self.assertEqual(Category.objects.filter(user=self.user).count(), len(CATEGORIES) + 1)

    def test_restructure_is_idempotent(self):
        apply_default_structure(self.user)
        apply_default_structure(self.user)
        self.assertEqual(Block.objects.filter(user=self.user).count(), 3)
        self.assertEqual(Category.objects.filter(user=self.user).count(), len(CATEGORIES) + 1)
