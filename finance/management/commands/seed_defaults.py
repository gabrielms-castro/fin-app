from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from finance.defaults import apply_default_structure, seed_user_defaults


class Command(BaseCommand):
    help = "Cria (ou reorganiza, com --restructure) blocos, naturezas e grupos padrão de um usuário."

    def add_arguments(self, parser):
        parser.add_argument("--user", required=True, help="username")
        parser.add_argument(
            "--restructure",
            action="store_true",
            help="Aplica a estrutura padrão atual a um usuário existente, migrando os lançamentos.",
        )

    def handle(self, *args, **options):
        User = get_user_model()
        try:
            user = User.objects.get(username=options["user"])
        except User.DoesNotExist as exc:
            raise CommandError(f"Usuário {options['user']} não encontrado") from exc
        if options["restructure"]:
            apply_default_structure(user)
            self.stdout.write(self.style.SUCCESS("Estrutura padrão aplicada; lançamentos preservados."))
        elif seed_user_defaults(user):
            self.stdout.write(self.style.SUCCESS("Configuração padrão criada."))
        else:
            self.stdout.write("Usuário já possui blocos; use --restructure para reorganizar.")
