from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("blocks", views.BlockViewSet, basename="block")
router.register("natures", views.NatureViewSet, basename="nature")
router.register("categories", views.CategoryViewSet, basename="category")
router.register("cards", views.CreditCardViewSet, basename="card")
router.register("invoices", views.InvoiceViewSet, basename="invoice")
router.register("installments", views.InstallmentViewSet, basename="installment")
router.register("expenses", views.ExpenseViewSet, basename="expense")
router.register("recurring", views.RecurringExpenseViewSet, basename="recurring")
router.register("income-sources", views.IncomeSourceViewSet, basename="income-source")
router.register("incomes", views.IncomeViewSet, basename="income")
router.register("month-plans", views.MonthPlanViewSet, basename="month-plan")
router.register("investments", views.InvestmentViewSet, basename="investment")
router.register("goals", views.GoalViewSet, basename="goal")
router.register("investment-movements", views.InvestmentMovementViewSet, basename="investment-movement")

urlpatterns = [
    path("dashboard/", views.dashboard, name="dashboard"),
    path("projection/", views.projection, name="projection"),
    path("meta/", views.meta, name="meta"),
    path("settings/", views.user_settings, name="settings"),
    path("settings/onboarding/<str:step>/", views.onboarding, name="onboarding"),
    path("apply-defaults/", views.apply_defaults, name="apply-defaults"),
    path("", include(router.urls)),
]
