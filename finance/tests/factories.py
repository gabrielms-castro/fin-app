from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model

from finance.models import Category, CreditCard, Expense, IncomeSource
from finance.services.installments import generate_installments


def make_user(username="gabriel"):
    return get_user_model().objects.create_user(username=username, password="senha-forte-123")


def category(user, name="Restaurantes e delivery"):
    return Category.objects.get(user=user, name=name)


def card(user, closing_day=5, due_day=12, **kwargs):
    return CreditCard.objects.create(
        user=user, name=kwargs.pop("name", "Nubank"), closing_day=closing_day, due_day=due_day,
        limit=Decimal("5000"), **kwargs
    )


def expense(user, amount="100.00", when=date(2026, 10, 3), method="debito", count=1, **kwargs):
    kwargs.setdefault("category", category(user))
    obj = Expense.objects.create(
        user=user, description=kwargs.pop("description", "Compra"), date=when,
        total_amount=Decimal(amount), payment_method=method, installments_count=count, **kwargs
    )
    generate_installments(obj)
    return obj


def salary(user, amount="6000", start=date(2026, 1, 1)):
    return IncomeSource.objects.create(user=user, name="Salário", amount=Decimal(amount), start_month=start)
