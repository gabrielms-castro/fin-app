import django_filters as filters

from .models import Expense, Income, Installment, InvestmentMovement, Invoice, PaymentMethod
from .services.dates import add_months, parse_month


class MonthFilter(filters.CharFilter):
    """Filtra um DateField de competência por 'YYYY-MM' (>= ou <=)."""

    def __init__(self, *args, upper=False, **kwargs):
        self.upper = upper
        super().__init__(*args, **kwargs)

    def filter(self, qs, value):
        month = parse_month(value)
        if not month:
            return qs
        lookup = "lte" if self.upper else "gte"
        return qs.filter(**{f"{self.field_name}__{lookup}": month})


class InstallmentFilter(filters.FilterSet):
    month = filters.CharFilter(method="filter_month")
    month_from = MonthFilter(field_name="competence")
    month_to = MonthFilter(field_name="competence", upper=True)
    date_from = filters.DateFilter(field_name="expense__date", lookup_expr="gte")
    date_to = filters.DateFilter(field_name="expense__date", lookup_expr="lte")
    category = filters.BaseInFilter(field_name="expense__category")
    nature = filters.BaseInFilter(field_name="expense__category__nature")
    block = filters.BaseInFilter(field_name="expense__category__nature__block")
    payment_method = filters.BaseInFilter(field_name="expense__payment_method")
    card = filters.NumberFilter(field_name="expense__card")
    kind = filters.BaseInFilter(field_name="expense__kind")
    expense = filters.NumberFilter(field_name="expense")
    invoice = filters.NumberFilter(field_name="invoice")
    paid = filters.BooleanFilter()
    min_amount = filters.NumberFilter(field_name="amount", lookup_expr="gte")
    max_amount = filters.NumberFilter(field_name="amount", lookup_expr="lte")

    class Meta:
        model = Installment
        fields = []

    def filter_month(self, qs, name, value):
        month = parse_month(value)
        return qs.filter(competence=month) if month else qs


class ExpenseFilter(filters.FilterSet):
    kind = filters.BaseInFilter()
    category = filters.BaseInFilter()
    payment_method = filters.ChoiceFilter(choices=PaymentMethod.choices)
    card = filters.NumberFilter()
    date_from = filters.DateFilter(field_name="date", lookup_expr="gte")
    date_to = filters.DateFilter(field_name="date", lookup_expr="lte")
    open = filters.BooleanFilter(method="filter_open")

    class Meta:
        model = Expense
        fields = []

    def filter_open(self, qs, name, value):
        if value is None:
            return qs
        open_ids = Installment.objects.filter(paid=False).values("expense")
        return qs.filter(id__in=open_ids) if value else qs.exclude(id__in=open_ids)


class InvoiceFilter(filters.FilterSet):
    card = filters.NumberFilter()
    month_from = MonthFilter(field_name="competence")
    month_to = MonthFilter(field_name="competence", upper=True)
    paid = filters.BooleanFilter()

    class Meta:
        model = Invoice
        fields = []


class IncomeFilter(filters.FilterSet):
    month = filters.CharFilter(method="filter_month")
    source = filters.NumberFilter()

    class Meta:
        model = Income
        fields = []

    def filter_month(self, qs, name, value):
        month = parse_month(value)
        if not month:
            return qs
        return qs.filter(date__gte=month, date__lt=add_months(month, 1))


class InvestmentMovementFilter(filters.FilterSet):
    month = filters.CharFilter(method="filter_month")
    investment = filters.NumberFilter()
    kind = filters.BaseInFilter()

    class Meta:
        model = InvestmentMovement
        fields = []

    def filter_month(self, qs, name, value):
        month = parse_month(value)
        if not month:
            return qs
        return qs.filter(date__gte=month, date__lt=add_months(month, 1))
