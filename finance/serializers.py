import re

from rest_framework import serializers

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
    UserSettings,
)
from .services.dates import month_start, today
from .services.investments import investment_stats
from .services.recurring import monthly_equivalent, next_charge


class OwnedSerializer(serializers.ModelSerializer):
    """Garante que FKs apontem apenas para objetos do próprio usuário."""

    def get_fields(self):
        fields = super().get_fields()
        request = self.context.get("request")
        user = getattr(request, "user", None)
        for field in fields.values():
            queryset = getattr(field, "queryset", None)
            if queryset is not None and hasattr(queryset.model, "user") and user:
                field.queryset = queryset.filter(user=user)
        return fields

    def to_internal_value(self, data):
        # Formulários enviam campos vazios como null; texto opcional é gravado como "".
        if hasattr(data, "copy"):
            data = data.copy()
            for name, field in self.fields.items():
                if (
                    isinstance(field, serializers.CharField)
                    and not field.allow_null
                    and field.allow_blank
                    and name in data
                    and data[name] is None
                ):
                    data[name] = ""
        return super().to_internal_value(data)

    def create(self, validated_data):
        validated_data["user"] = self.context["request"].user
        return super().create(validated_data)


HEX_COLOR = re.compile(r"^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")


def normalize_color(value):
    """Aceita #RGB, #RRGGBB (com ou sem #) e devolve #rrggbb."""
    match = HEX_COLOR.match((value or "").strip())
    if not match:
        raise serializers.ValidationError("Use um código hex no formato #RRGGBB ou #RGB.")
    digits = match.group(1)
    if len(digits) == 3:
        digits = "".join(c * 2 for c in digits)
    return f"#{digits.lower()}"


class BlockSerializer(OwnedSerializer):
    class Meta:
        model = Block
        fields = ["id", "name", "kind", "value", "color", "order"]

    def validate_color(self, value):
        return normalize_color(value)


class NatureSerializer(OwnedSerializer):
    block_name = serializers.CharField(source="block.name", read_only=True)

    class Meta:
        model = Nature
        fields = ["id", "name", "block", "block_name", "order"]


class CategorySerializer(OwnedSerializer):
    nature_name = serializers.CharField(source="nature.name", read_only=True)
    block = serializers.IntegerField(source="nature.block_id", read_only=True)
    block_name = serializers.CharField(source="nature.block.name", read_only=True)
    block_color = serializers.CharField(source="nature.block.color", read_only=True)

    class Meta:
        model = Category
        fields = [
            "id", "name", "scope", "nature", "nature_name", "block", "block_name", "block_color", "description",
            "active",
        ]


class CreditCardSerializer(OwnedSerializer):
    used_limit = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    best_purchase_day = serializers.IntegerField(read_only=True)

    class Meta:
        model = CreditCard
        fields = [
            "id", "name", "brand", "limit", "closing_day", "due_day", "color", "active",
            "used_limit", "best_purchase_day",
        ]

    def validate_color(self, value):
        return normalize_color(value)


class InvoiceSerializer(serializers.ModelSerializer):
    card_name = serializers.CharField(source="card.name", read_only=True)
    total = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)

    class Meta:
        model = Invoice
        fields = ["id", "card", "card_name", "competence", "closing_date", "due_date", "paid", "paid_at", "total"]
        read_only_fields = fields


class InstallmentSerializer(serializers.ModelSerializer):
    description = serializers.CharField(source="expense.description", read_only=True)
    kind = serializers.CharField(source="expense.kind", read_only=True)
    date = serializers.DateField(source="expense.date", read_only=True)
    payment_method = serializers.CharField(source="expense.payment_method", read_only=True)
    card = serializers.IntegerField(source="expense.card_id", read_only=True)
    card_name = serializers.CharField(source="expense.card.name", read_only=True, default=None)
    category = serializers.IntegerField(source="expense.category_id", read_only=True)
    category_name = serializers.CharField(source="expense.category.name", read_only=True)
    nature_name = serializers.CharField(source="expense.category.nature.name", read_only=True)
    nature = serializers.IntegerField(source="expense.category.nature_id", read_only=True)
    block = serializers.IntegerField(source="expense.category.nature.block_id", read_only=True)
    block_name = serializers.CharField(source="expense.category.nature.block.name", read_only=True)
    block_color = serializers.CharField(source="expense.category.nature.block.color", read_only=True)
    installments_count = serializers.IntegerField(source="expense.installments_count", read_only=True)

    class Meta:
        model = Installment
        fields = [
            "id", "expense", "number", "installments_count", "amount", "due_date", "competence",
            "invoice", "paid", "paid_at", "description", "kind", "date", "payment_method", "card",
            "card_name", "category", "category_name", "nature", "nature_name", "block", "block_name",
            "block_color",
        ]
        read_only_fields = fields


class ExpenseSerializer(OwnedSerializer):
    category_name = serializers.CharField(source="category.name", read_only=True)
    # Natureza e bloco são sempre derivados do grupo (não editáveis no lançamento).
    nature = serializers.IntegerField(source="category.nature_id", read_only=True)
    nature_name = serializers.CharField(source="category.nature.name", read_only=True)
    block = serializers.IntegerField(source="category.nature.block_id", read_only=True)
    block_name = serializers.CharField(source="category.nature.block.name", read_only=True)
    card_name = serializers.CharField(source="card.name", read_only=True, default=None)
    paid_count = serializers.SerializerMethodField()
    installments = serializers.SerializerMethodField()

    class Meta:
        model = Expense
        fields = [
            "id", "kind", "description", "date", "total_amount", "installments_count",
            "installment_amount", "payment_method", "card", "card_name", "category",
            "category_name", "nature", "nature_name", "block", "block_name", "first_due_date", "creditor", "interest_rate", "notes",
            "recurring", "paid_count", "installments", "created_at",
        ]
        read_only_fields = ["recurring", "created_at"]
        extra_kwargs = {"total_amount": {"required": False}}

    def get_paid_count(self, obj):
        return sum(1 for i in obj.installments.all() if i.paid)

    def get_installments(self, obj):
        if not self.context.get("with_installments"):
            return None
        return [
            {"id": i.id, "number": i.number, "amount": i.amount, "due_date": i.due_date,
             "competence": i.competence, "paid": i.paid}
            for i in obj.installments.all()
        ]

    def validate(self, attrs):
        get = lambda key: attrs.get(key, getattr(self.instance, key, None))  # noqa: E731
        kind = get("kind") or Expense.PURCHASE
        if kind == Expense.INVESTMENT or (self.instance and self.instance.kind == Expense.INVESTMENT):
            raise serializers.ValidationError({"kind": "Aportes são registrados na aba Investimentos."})
        if self.instance and "kind" in attrs and attrs["kind"] != self.instance.kind:
            raise serializers.ValidationError({"kind": "Não é possível mudar o tipo do lançamento."})
        category = get("category")
        expected = Expense.SCOPE_BY_KIND[kind]
        if category and category.scope != expected:
            message = {
                Category.EXPENSE: "Use um grupo de gasto. Dívidas e investimentos têm abas próprias.",
                Category.DEBT: "Dívidas precisam de um grupo do tipo Dívidas.",
            }[expected]
            raise serializers.ValidationError({"category": message})
        method = get("payment_method")
        if method == PaymentMethod.CREDIT and not get("card"):
            raise serializers.ValidationError({"card": "Informe o cartão para compras no crédito."})
        if method != PaymentMethod.CREDIT:
            attrs["card"] = None
        if not get("total_amount") and not get("installment_amount"):
            raise serializers.ValidationError({"total_amount": "Informe o valor total ou da parcela."})
        if get("installment_amount"):
            attrs["total_amount"] = get("installment_amount") * (get("installments_count") or 1)
        if (attrs.get("total_amount") or get("total_amount")) <= 0:
            raise serializers.ValidationError({"total_amount": "O valor deve ser positivo."})
        return attrs


class RecurringExpenseSerializer(OwnedSerializer):
    category_name = serializers.CharField(source="category.name", read_only=True)
    nature_name = serializers.CharField(source="category.nature.name", read_only=True)
    block_name = serializers.CharField(source="category.nature.block.name", read_only=True)
    card_name = serializers.CharField(source="card.name", read_only=True, default=None)
    card_color = serializers.CharField(source="card.color", read_only=True, default=None)
    next_charge = serializers.SerializerMethodField()
    monthly_amount = serializers.SerializerMethodField()

    class Meta:
        model = RecurringExpense
        fields = [
            "id", "kind", "frequency", "description", "amount", "monthly_amount", "category",
            "category_name", "nature_name", "block_name", "payment_method", "card", "card_name", "card_color",
            "day", "start_month", "end_month", "active", "next_charge",
        ]

    def get_next_charge(self, obj):
        return next_charge(obj)

    def get_monthly_amount(self, obj):
        return monthly_equivalent(obj)

    def validate(self, attrs):
        method = attrs.get("payment_method", getattr(self.instance, "payment_method", None))
        card = attrs.get("card", getattr(self.instance, "card", None))
        category = attrs.get("category", getattr(self.instance, "category", None))
        if category and category.scope != Category.EXPENSE:
            raise serializers.ValidationError(
                {"category": "Use um grupo de gasto. Dívidas e investimentos têm abas próprias."}
            )
        if method == PaymentMethod.CREDIT and not card:
            raise serializers.ValidationError({"card": "Informe o cartão para recorrentes no crédito."})
        for key in ("start_month", "end_month"):
            if attrs.get(key):
                attrs[key] = month_start(attrs[key])
        return attrs


class IncomeSourceSerializer(OwnedSerializer):
    class Meta:
        model = IncomeSource
        fields = ["id", "name", "amount", "day", "start_month", "end_month", "active"]

    def validate(self, attrs):
        for key in ("start_month", "end_month"):
            if attrs.get(key):
                attrs[key] = month_start(attrs[key])
        return attrs


class IncomeSerializer(OwnedSerializer):
    source_name = serializers.CharField(source="source.name", read_only=True, default=None)

    class Meta:
        model = Income
        fields = ["id", "date", "amount", "description", "source", "source_name"]


class MonthPlanSerializer(OwnedSerializer):
    class Meta:
        model = MonthPlan
        fields = ["id", "competence", "expected_income"]
        validators = []

    def validate_competence(self, value):
        return month_start(value)


class InvestmentSerializer(OwnedSerializer):
    category_name = serializers.CharField(source="category.name", read_only=True)
    stats = serializers.SerializerMethodField()

    class Meta:
        model = Investment
        fields = [
            "id", "name", "type", "institution", "category", "category_name", "goal", "monthly_target",
            "color", "active", "notes", "stats",
        ]

    def get_stats(self, obj):
        return investment_stats(obj, self.context.get("month") or today())

    def validate_color(self, value):
        return normalize_color(value)

    def validate_category(self, value):
        if value.scope != Category.INVESTMENT:
            raise serializers.ValidationError("Escolha um grupo do tipo Investimentos.")
        return value


class InvestmentMovementSerializer(OwnedSerializer):
    investment_name = serializers.CharField(source="investment.name", read_only=True)
    investment_color = serializers.CharField(source="investment.color", read_only=True)

    class Meta:
        model = InvestmentMovement
        fields = ["id", "investment", "investment_name", "investment_color", "kind", "date", "amount", "notes"]

    def validate(self, attrs):
        kind = attrs.get("kind", getattr(self.instance, "kind", None))
        amount = attrs.get("amount", getattr(self.instance, "amount", None))
        if kind != InvestmentMovement.YIELD and amount is not None and amount <= 0:
            raise serializers.ValidationError({"amount": "O valor deve ser positivo."})
        return attrs


class UserSettingsSerializer(serializers.ModelSerializer):
    onboarding_pending = serializers.BooleanField(read_only=True)

    class Meta:
        model = UserSettings
        fields = ["installment_ceiling_pct", "onboarding_completed_at", "onboarding_skipped_at", "onboarding_pending"]
        read_only_fields = ["onboarding_completed_at", "onboarding_skipped_at"]
