from django.conf import settings
from django.db import migrations


def backfill(apps, schema_editor):
    """Usuários existentes ganham configurações com o onboarding pendente (veem o wizard uma vez)."""
    User = apps.get_model(*settings.AUTH_USER_MODEL.split("."))
    UserSettings = apps.get_model("finance", "UserSettings")
    existing = set(UserSettings.objects.values_list("user_id", flat=True))
    UserSettings.objects.bulk_create(
        UserSettings(user_id=pk) for pk in User.objects.values_list("pk", flat=True) if pk not in existing
    )


class Migration(migrations.Migration):
    dependencies = [
        ("finance", "0005_user_settings_and_goals"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [migrations.RunPython(backfill, migrations.RunPython.noop)]
