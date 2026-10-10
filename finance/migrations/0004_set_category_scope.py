from django.db import migrations

DEBT = ["Empréstimos e financiamentos", "Dívidas"]
INVESTMENT = ["Investimentos", "Reserva de emergência"]


def set_scope(apps, schema_editor):
    Category = apps.get_model("finance", "Category")
    Category.objects.filter(name__in=DEBT).update(scope="divida")
    Category.objects.filter(name__in=INVESTMENT).update(scope="investimento")


class Migration(migrations.Migration):
    dependencies = [("finance", "0003_investments_and_category_scope")]

    operations = [migrations.RunPython(set_scope, migrations.RunPython.noop)]
