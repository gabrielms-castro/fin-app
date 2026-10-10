import csv
from datetime import date
from decimal import Decimal, InvalidOperation

from django.contrib.auth.decorators import login_required
from django.db.models import Prefetch, ProtectedError
from django.http import HttpResponse
from django.shortcuts import render
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from . import serializers as s
from .defaults import apply_default_structure
from .filters import (
    ExpenseFilter,
    IncomeFilter,
    InstallmentFilter,
    InvestmentMovementFilter,
    InvoiceFilter,
)
from .models import (
    Block,
    Category,
    CreditCard,
    Expense,
    Income,
    IncomeSource,
    Installment,
    Investment,
    InvestmentMovement,
    Invoice,
    MonthPlan,
    Nature,
    PaymentMethod,
    RecurringExpense,
)
from .services import budget
from .services.billing import invoice_cycle
from .services.dates import add_months, month_start, parse_month, today
from .services.installments import (
    delete_empty_invoices,
    first_competence,
    generate_installments,
    set_invoice_paid,
    split_amount,
)
from .services.recurring import materialize
from .services.investments import delete_movement, investments_summary, set_balance, sync_expense


FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def csv_text(value):
    """Evita que textos do usuário sejam interpretados como fórmula no Excel/Sheets."""
    value = str(value or "")
    return f"'{value}" if value.startswith(FORMULA_PREFIXES) else value


@login_required
@ensure_csrf_cookie
def index(request):
    return render(request, "index.html")


class OwnedViewSet(viewsets.ModelViewSet):
    def get_queryset(self):
        return super().get_queryset().filter(user=self.request.user)

    def destroy(self, request, *args, **kwargs):
        try:
            return super().destroy(request, *args, **kwargs)
        except ProtectedError:
            return Response(
                {"detail": "Não é possível excluir: existem registros vinculados."},
                status=status.HTTP_409_CONFLICT,
            )


class BlockViewSet(OwnedViewSet):
    queryset = Block.objects.all()
    serializer_class = s.BlockSerializer
    pagination_class = None


class NatureViewSet(OwnedViewSet):
    queryset = Nature.objects.select_related("block")
    serializer_class = s.NatureSerializer
    pagination_class = None


class CategoryViewSet(OwnedViewSet):
    queryset = Category.objects.select_related("nature__block")
    serializer_class = s.CategorySerializer
    pagination_class = None


class CreditCardViewSet(OwnedViewSet):
    queryset = CreditCard.objects.all()
    serializer_class = s.CreditCardSerializer
    pagination_class = None

    def perform_update(self, serializer):
        card = serializer.save()
        # Fechamento/vencimento podem ter mudado: recalcula faturas em aberto.
        for expense in Expense.objects.filter(card=card, installments__paid=False).distinct():
            generate_installments(expense)

    @action(detail=True)
    def preview(self, request, pk=None):
        """Em qual fatura cai uma compra feita em `date` (com `installments` parcelas)."""
        card = self.get_object()
        purchase_date = request.query_params.get("date")
        try:
            purchase = date.fromisoformat(purchase_date) if purchase_date else today()
        except ValueError:
            return Response({"detail": "Data inválida"}, status=400)
        competence, closing, due = invoice_cycle(card, purchase)
        return Response({"competence": competence, "closing_date": closing, "due_date": due})


class InvoiceViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = s.InvoiceSerializer
    filterset_class = InvoiceFilter
    pagination_class = None

    def get_queryset(self):
        return Invoice.objects.filter(user=self.request.user).select_related("card")

    @action(detail=True, methods=["post"])
    def pay(self, request, pk=None):
        invoice = set_invoice_paid(self.get_object(), True)
        return Response(self.get_serializer(invoice).data)

    @action(detail=True, methods=["post"])
    def unpay(self, request, pk=None):
        invoice = set_invoice_paid(self.get_object(), False)
        return Response(self.get_serializer(invoice).data)


class InstallmentViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = s.InstallmentSerializer
    filterset_class = InstallmentFilter
    search_fields = ["expense__description", "expense__notes", "expense__creditor"]
    ordering_fields = ["competence", "due_date", "amount", "expense__date", "expense__description"]
    ordering = ["-expense__date", "-id"]

    def get_queryset(self):
        materialize(self.request.user)
        return Installment.objects.filter(user=self.request.user).select_related(
            "expense__card", "expense__category__nature__block"
        )

    def list(self, request, *args, **kwargs):
        response = super().list(request, *args, **kwargs)
        qs = self.filter_queryset(self.get_queryset())
        totals = {"total": 0, "paid": 0, "pending": 0}
        for amount, paid in qs.values_list("amount", "paid"):
            totals["total"] += amount
            totals["paid" if paid else "pending"] += amount
        response.data["totals"] = totals
        return response

    @action(detail=True, methods=["post"])
    def pay(self, request, pk=None):
        installment = self.get_object()
        paid = request.data.get("paid", True) not in (False, "false", "0", 0)
        installment.paid = paid
        installment.paid_at = today() if paid else None
        installment.save(update_fields=["paid", "paid_at"])
        return Response(self.get_serializer(installment).data)

    @action(detail=False, url_path="export")
    def export(self, request):
        qs = self.filter_queryset(self.get_queryset())
        response = HttpResponse(content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = 'attachment; filename="lancamentos.csv"'
        response.write("﻿")
        writer = csv.writer(response, delimiter=";")
        writer.writerow(
            ["Competência", "Data compra", "Vencimento", "Descrição", "Parcela", "Valor",
             "Forma", "Cartão", "Grupo", "Natureza", "Bloco", "Tipo", "Pago"]
        )
        methods = dict(PaymentMethod.choices)
        for i in qs:
            e = i.expense
            writer.writerow(
                [
                    i.competence.strftime("%m/%Y"), e.date.strftime("%d/%m/%Y"),
                    i.due_date.strftime("%d/%m/%Y"), csv_text(e.description),
                    f"{i.number}/{e.installments_count}", str(i.amount).replace(".", ","),
                    methods.get(e.payment_method, e.payment_method), csv_text(e.card.name if e.card else ""),
                    csv_text(e.category.name), csv_text(e.category.nature.name),
                    csv_text(e.category.nature.block.name),
                    e.get_kind_display(), "sim" if i.paid else "não",
                ]
            )
        return response


class ExpenseViewSet(OwnedViewSet):
    serializer_class = s.ExpenseSerializer
    filterset_class = ExpenseFilter
    search_fields = ["description", "notes", "creditor"]
    ordering_fields = ["date", "total_amount", "description"]

    def get_queryset(self):
        return Expense.objects.filter(user=self.request.user).select_related(
            "card", "category__nature__block"
        ).prefetch_related(Prefetch("installments", queryset=Installment.objects.order_by("number")))

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["with_installments"] = self.action != "list" or self.request.query_params.get(
            "with_installments"
        )
        return context

    def perform_create(self, serializer):
        generate_installments(serializer.save())

    def perform_update(self, serializer):
        generate_installments(serializer.save())

    def perform_destroy(self, instance):
        if instance.kind == Expense.INVESTMENT:
            raise ValidationError({"detail": "Aportes são gerenciados na aba Investimentos."})
        user = instance.user
        instance.delete()
        delete_empty_invoices(user)

    @action(detail=False, methods=["post"])
    def preview(self, request):
        """Simula as parcelas sem gravar (para o formulário)."""
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        expense = Expense(user=request.user, **data)
        count = expense.installments_count
        amounts = (
            [expense.installment_amount] * count
            if expense.installment_amount
            else split_amount(expense.total_amount, count)
        )
        if expense.payment_method == PaymentMethod.CREDIT and expense.card:
            start = first_competence(expense)
            months = [add_months(start, i) for i in range(count)]
        else:
            start = expense.first_due_date or expense.date
            months = [month_start(add_months(start, i)) for i in range(count)]
        return Response(
            {"installments": [{"number": i + 1, "amount": a, "competence": m}
                              for i, (a, m) in enumerate(zip(amounts, months))]}
        )


class RecurringExpenseViewSet(OwnedViewSet):
    queryset = RecurringExpense.objects.select_related("category__nature__block", "card")
    serializer_class = s.RecurringExpenseSerializer
    pagination_class = None

    def get_queryset(self):
        qs = super().get_queryset()
        kind = self.request.query_params.get("kind")
        return qs.filter(kind=kind) if kind else qs


class IncomeSourceViewSet(OwnedViewSet):
    queryset = IncomeSource.objects.all()
    serializer_class = s.IncomeSourceSerializer
    pagination_class = None


class IncomeViewSet(OwnedViewSet):
    queryset = Income.objects.select_related("source")
    serializer_class = s.IncomeSerializer
    filterset_class = IncomeFilter
    search_fields = ["description"]


class MonthPlanViewSet(OwnedViewSet):
    queryset = MonthPlan.objects.all()
    serializer_class = s.MonthPlanSerializer
    pagination_class = None

    def create(self, request, *args, **kwargs):
        # upsert por competência
        competence = parse_month(request.data.get("competence"))
        existing = self.get_queryset().filter(competence=competence).first() if competence else None
        if existing:
            serializer = self.get_serializer(existing, data=request.data)
            serializer.is_valid(raise_exception=True)
            serializer.save()
            return Response(serializer.data)
        return super().create(request, *args, **kwargs)


class InvestmentViewSet(OwnedViewSet):
    queryset = Investment.objects.select_related("category")
    serializer_class = s.InvestmentSerializer
    pagination_class = None

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["month"] = parse_month(self.request.query_params.get("month"), today())
        return context

    def perform_update(self, serializer):
        investment = serializer.save()
        # Grupo/nome podem ter mudado: atualiza os lançamentos dos aportes.
        for movement in investment.movements.filter(kind=InvestmentMovement.DEPOSIT):
            sync_expense(movement)

    def perform_destroy(self, instance):
        for movement in instance.movements.all():
            delete_movement(movement)
        instance.delete()

    @action(detail=False)
    def summary(self, request):
        month = parse_month(request.query_params.get("month"), today())
        return Response(investments_summary(request.user, month))

    @action(detail=True, methods=["post"])
    def balance(self, request, pk=None):
        """Informa o saldo atual; a diferença vira um rendimento (positivo ou negativo)."""
        investment = self.get_object()
        try:
            value = Decimal(str(request.data.get("value")))
            when = date.fromisoformat(request.data.get("date") or today().isoformat())
        except (InvalidOperation, ValueError):
            return Response({"value": ["Informe um valor e uma data válidos."]}, status=400)
        set_balance(investment, value, when)
        return Response(self.get_serializer(investment).data)


class InvestmentMovementViewSet(OwnedViewSet):
    queryset = InvestmentMovement.objects.select_related("investment")
    serializer_class = s.InvestmentMovementSerializer
    filterset_class = InvestmentMovementFilter

    def perform_create(self, serializer):
        sync_expense(serializer.save())

    def perform_update(self, serializer):
        sync_expense(serializer.save())

    def perform_destroy(self, instance):
        delete_movement(instance)


@api_view(["GET"])
def dashboard(request):
    month = parse_month(request.query_params.get("month"), today().replace(day=1))
    return Response(budget.month_summary(request.user, month))


@api_view(["GET"])
def projection(request):
    try:
        months = max(1, min(int(request.query_params.get("months", 12)), 36))
    except ValueError:
        months = 12
    start = parse_month(request.query_params.get("start"))
    return Response(budget.projection(request.user, months, start))


@api_view(["POST"])
def apply_defaults(request):
    """Aplica a estrutura padrão (50/30/20) preservando os lançamentos."""
    apply_default_structure(request.user)
    return Response({"detail": "Estrutura padrão aplicada."})


@api_view(["GET"])
def meta(request):
    return Response(
        {
            "payment_methods": [{"value": v, "label": l} for v, l in PaymentMethod.choices],
            "expense_kinds": [{"value": v, "label": l} for v, l in Expense.KIND_CHOICES],
            "block_kinds": [{"value": v, "label": l} for v, l in Block.KIND_CHOICES],
            "frequencies": [{"value": v, "label": l} for v, l in RecurringExpense.FREQUENCY_CHOICES],
            "category_scopes": [{"value": v, "label": l} for v, l in Category.SCOPE_CHOICES],
            "investment_types": [{"value": v, "label": l} for v, l in Investment.TYPE_CHOICES],
            "movement_kinds": [{"value": v, "label": l} for v, l in InvestmentMovement.KIND_CHOICES],
            "user": request.user.get_username(),
            "today": today(),
        }
    )
