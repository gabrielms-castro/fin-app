from decimal import Decimal

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import Sum

DAY_VALIDATORS = [MinValueValidator(1), MaxValueValidator(31)]


class Owned(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)

    class Meta:
        abstract = True


class Block(Owned):
    """Bloco do salário (ex.: Gastos Fixos 60%)."""

    PERCENT, FIXED = "percent", "fixed"
    KIND_CHOICES = [(PERCENT, "% da entrada"), (FIXED, "Valor fixo")]

    name = models.CharField(max_length=80)
    kind = models.CharField(max_length=10, choices=KIND_CHOICES, default=PERCENT)
    value = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    color = models.CharField(max_length=9, default="#4f46e5")
    order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["order", "id"]

    def __str__(self):
        return self.name

    def budget_for(self, expected_income):
        if self.kind == self.PERCENT:
            return (expected_income * self.value / Decimal(100)).quantize(Decimal("0.01"))
        return self.value


class Nature(Owned):
    """Natureza financeira (Essencial fixo, Discricionário...)."""

    name = models.CharField(max_length=80)
    block = models.ForeignKey(Block, on_delete=models.PROTECT, related_name="natures")
    order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["order", "id"]

    def __str__(self):
        return self.name


class Category(Owned):
    """Grupo de gasto (Moradia, Mercado...). Natureza e bloco vêm sempre daqui."""

    EXPENSE, DEBT, INVESTMENT = "gasto", "divida", "investimento"
    SCOPE_CHOICES = [(EXPENSE, "Gastos"), (DEBT, "Dívidas"), (INVESTMENT, "Investimentos")]

    name = models.CharField(max_length=80)
    scope = models.CharField(max_length=12, choices=SCOPE_CHOICES, default=EXPENSE)
    nature = models.ForeignKey(Nature, on_delete=models.PROTECT, related_name="categories")
    description = models.CharField(max_length=255, blank=True)
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]
        verbose_name_plural = "categories"

    def __str__(self):
        return self.name


class CreditCard(Owned):
    name = models.CharField(max_length=80)
    brand = models.CharField(max_length=40, blank=True)
    limit = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    closing_day = models.PositiveSmallIntegerField(validators=DAY_VALIDATORS)
    due_day = models.PositiveSmallIntegerField(validators=DAY_VALIDATORS)
    color = models.CharField(max_length=9, default="#0ea5e9")
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name

    @property
    def best_purchase_day(self):
        return self.closing_day

    @property
    def used_limit(self):
        total = Installment.objects.filter(expense__card=self, paid=False).aggregate(t=Sum("amount"))["t"]
        return total or Decimal("0")


class Invoice(Owned):
    """Fatura do cartão. competence = 1º dia do mês de vencimento."""

    card = models.ForeignKey(CreditCard, on_delete=models.CASCADE, related_name="invoices")
    competence = models.DateField()
    closing_date = models.DateField()
    due_date = models.DateField()
    paid = models.BooleanField(default=False)
    paid_at = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ["competence"]
        constraints = [
            models.UniqueConstraint(fields=["card", "competence"], name="unique_invoice_per_month")
        ]

    def __str__(self):
        return f"{self.card} {self.competence:%m/%Y}"

    @property
    def total(self):
        return self.installments.aggregate(t=Sum("amount"))["t"] or Decimal("0")


class PaymentMethod(models.TextChoices):
    CASH = "dinheiro", "Dinheiro"
    DEBIT = "debito", "Débito"
    PIX = "pix", "Pix"
    CREDIT = "credito", "Crédito"
    BOLETO = "boleto", "Boleto"
    TRANSFER = "transferencia", "Transferência"


INSTANT_METHODS = {PaymentMethod.CASH, PaymentMethod.DEBIT, PaymentMethod.PIX}


class RecurringExpense(Owned):
    BILL, SUBSCRIPTION = "conta", "assinatura"
    KIND_CHOICES = [(BILL, "Conta fixa"), (SUBSCRIPTION, "Assinatura")]
    MONTHLY, YEARLY = "mensal", "anual"
    FREQUENCY_CHOICES = [(MONTHLY, "Mensal"), (YEARLY, "Anual")]

    kind = models.CharField(max_length=10, choices=KIND_CHOICES, default=BILL)
    frequency = models.CharField(max_length=10, choices=FREQUENCY_CHOICES, default=MONTHLY)
    description = models.CharField(max_length=120)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    category = models.ForeignKey(Category, on_delete=models.PROTECT)
    payment_method = models.CharField(max_length=15, choices=PaymentMethod.choices)
    card = models.ForeignKey(CreditCard, on_delete=models.SET_NULL, null=True, blank=True)
    day = models.PositiveSmallIntegerField(validators=DAY_VALIDATORS, default=1)
    start_month = models.DateField()
    end_month = models.DateField(null=True, blank=True)
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ["description"]

    def __str__(self):
        return self.description


class Expense(Owned):
    PURCHASE, DEBT, RECURRING, INVESTMENT = "compra", "divida", "recorrente", "investimento"
    KIND_CHOICES = [
        (PURCHASE, "Compra"), (DEBT, "Dívida"), (RECURRING, "Recorrente"), (INVESTMENT, "Investimento"),
    ]
    # Grupo de gasto aceito por tipo de lançamento.
    SCOPE_BY_KIND = {
        PURCHASE: Category.EXPENSE, RECURRING: Category.EXPENSE,
        DEBT: Category.DEBT, INVESTMENT: Category.INVESTMENT,
    }

    kind = models.CharField(max_length=12, choices=KIND_CHOICES, default=PURCHASE)
    description = models.CharField(max_length=120)
    date = models.DateField()
    total_amount = models.DecimalField(max_digits=12, decimal_places=2)
    installments_count = models.PositiveSmallIntegerField(default=1, validators=[MinValueValidator(1)])
    installment_amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    payment_method = models.CharField(max_length=15, choices=PaymentMethod.choices)
    card = models.ForeignKey(
        CreditCard, on_delete=models.PROTECT, null=True, blank=True, related_name="expenses"
    )
    category = models.ForeignKey(Category, on_delete=models.PROTECT, related_name="expenses")
    first_due_date = models.DateField(null=True, blank=True)
    creditor = models.CharField(max_length=120, blank=True)
    interest_rate = models.DecimalField(max_digits=6, decimal_places=3, null=True, blank=True)
    notes = models.TextField(blank=True)
    recurring = models.ForeignKey(
        RecurringExpense, on_delete=models.SET_NULL, null=True, blank=True, related_name="expenses"
    )
    recurring_month = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["recurring", "recurring_month"], name="unique_recurring_occurrence"
            )
        ]

    def __str__(self):
        return self.description


class Installment(Owned):
    expense = models.ForeignKey(Expense, on_delete=models.CASCADE, related_name="installments")
    number = models.PositiveSmallIntegerField()
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    due_date = models.DateField()
    competence = models.DateField()
    invoice = models.ForeignKey(
        Invoice, on_delete=models.SET_NULL, null=True, blank=True, related_name="installments"
    )
    paid = models.BooleanField(default=False)
    paid_at = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ["competence", "due_date", "id"]
        indexes = [models.Index(fields=["user", "competence"])]

    def __str__(self):
        return f"{self.expense} {self.number}/{self.expense.installments_count}"


class IncomeSource(Owned):
    name = models.CharField(max_length=80)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    day = models.PositiveSmallIntegerField(validators=DAY_VALIDATORS, default=5)
    start_month = models.DateField()
    end_month = models.DateField(null=True, blank=True)
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Income(Owned):
    date = models.DateField()
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    description = models.CharField(max_length=120)
    source = models.ForeignKey(IncomeSource, on_delete=models.SET_NULL, null=True, blank=True)

    class Meta:
        ordering = ["-date", "-id"]

    def __str__(self):
        return self.description


class MonthPlan(Owned):
    """Sobrescreve a entrada esperada de um mês específico."""

    competence = models.DateField()
    expected_income = models.DecimalField(max_digits=12, decimal_places=2)

    class Meta:
        ordering = ["competence"]
        constraints = [
            models.UniqueConstraint(fields=["user", "competence"], name="unique_month_plan")
        ]


class Investment(Owned):
    TYPE_CHOICES = [
        ("reserva", "Reserva de emergência"),
        ("renda_fixa", "Renda fixa"),
        ("renda_variavel", "Renda variável"),
        ("fundos", "Fundos"),
        ("previdencia", "Previdência"),
        ("cripto", "Cripto"),
        ("outros", "Outros"),
    ]

    name = models.CharField(max_length=80)
    type = models.CharField(max_length=20, choices=TYPE_CHOICES, default="renda_fixa")
    institution = models.CharField(max_length=80, blank=True)
    category = models.ForeignKey(Category, on_delete=models.PROTECT, related_name="investments")
    goal = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    monthly_target = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    color = models.CharField(max_length=9, default="#10b981")
    active = models.BooleanField(default=True)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class InvestmentMovement(Owned):
    """Aporte (sai do orçamento), resgate (volta ao caixa) ou rendimento (valorização)."""

    DEPOSIT, WITHDRAWAL, YIELD = "aporte", "resgate", "rendimento"
    KIND_CHOICES = [(DEPOSIT, "Aporte"), (WITHDRAWAL, "Resgate"), (YIELD, "Rendimento")]
    SIGN = {DEPOSIT: 1, WITHDRAWAL: -1, YIELD: 1}

    investment = models.ForeignKey(Investment, on_delete=models.CASCADE, related_name="movements")
    kind = models.CharField(max_length=12, choices=KIND_CHOICES)
    date = models.DateField()
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    notes = models.CharField(max_length=255, blank=True)
    # Aportes geram um lançamento para entrar no orçamento (bloco do grupo do investimento).
    expense = models.OneToOneField(
        Expense, on_delete=models.SET_NULL, null=True, blank=True, related_name="investment_movement"
    )

    class Meta:
        ordering = ["-date", "-id"]

    def __str__(self):
        return f"{self.get_kind_display()} {self.investment} {self.amount}"
