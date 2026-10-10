from django.contrib import admin

from .models import (
    Block,
    Category,
    CreditCard,
    Expense,
    Income,
    IncomeSource,
    Installment,
    Invoice,
    MonthPlan,
    Nature,
    RecurringExpense,
)


class InstallmentInline(admin.TabularInline):
    model = Installment
    extra = 0
    fields = ["number", "amount", "due_date", "competence", "invoice", "paid", "paid_at"]


@admin.register(Expense)
class ExpenseAdmin(admin.ModelAdmin):
    list_display = ["description", "kind", "date", "total_amount", "installments_count", "payment_method", "card", "category", "user"]
    list_filter = ["kind", "payment_method", "card", "category"]
    search_fields = ["description", "notes"]
    inlines = [InstallmentInline]


@admin.register(Invoice)
class InvoiceAdmin(admin.ModelAdmin):
    list_display = ["card", "competence", "closing_date", "due_date", "paid"]
    list_filter = ["card", "paid"]


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ["name", "nature", "active", "user"]


@admin.register(Nature)
class NatureAdmin(admin.ModelAdmin):
    list_display = ["name", "block", "order", "user"]


@admin.register(Block)
class BlockAdmin(admin.ModelAdmin):
    list_display = ["name", "kind", "value", "order", "user"]


for model in (CreditCard, RecurringExpense, IncomeSource, Income, MonthPlan, Installment):
    admin.site.register(model)
