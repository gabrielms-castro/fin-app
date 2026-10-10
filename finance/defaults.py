"""Estrutura padrão de blocos, naturezas e grupos de gasto (regra 50/30/20).

- Essenciais (50%): o que mantém a vida funcionando — fixos, variáveis e imprevistos.
- Estilo de vida (30%): escolhas e prazeres; é onde cortar primeiro quando apertar.
- Prioridades financeiras (20%): reserva de emergência, investimentos e quitação de dívidas.

Cada grupo de gasto pertence a uma única natureza, e os grupos não se sobrepõem
(ex.: mercado é essencial; restaurante/delivery é estilo de vida).
"""

from django.db import transaction

from .models import Block, Category, Expense, Nature, RecurringExpense

BLOCKS = [
    # nome, %, cor, nomes antigos aceitos para renomear no lugar
    ("Essenciais", 50, "#6366f1", ["Gastos Fixos"]),
    ("Estilo de vida", 30, "#f59e0b", ["Gastos Pessoais"]),
    ("Prioridades financeiras", 20, "#10b981", ["Investimentos ou Dívidas"]),
]

NATURES = [
    ("Essencial fixo", "Essenciais"),
    ("Essencial variável", "Essenciais"),
    ("Extraordinário", "Essenciais"),
    ("Discricionário", "Estilo de vida"),
    ("Patrimônio", "Prioridades financeiras"),
    ("Dívidas e juros", "Prioridades financeiras"),
]

CATEGORIES = [
    # nome, natureza, descrição, nomes antigos
    ("Moradia", "Essencial fixo", "Aluguel ou financiamento, condomínio, IPTU", []),
    ("Contas da casa", "Essencial fixo", "Energia, água, gás, internet", []),
    ("Comunicação", "Essencial fixo", "Plano de celular, telefone", []),
    ("Plano de saúde e seguros", "Essencial fixo", "Plano de saúde, odontológico, seguros de vida, residencial e do carro", []),
    ("Educação", "Essencial fixo", "Mensalidade de faculdade, escola, pós-graduação", []),
    ("Mercado", "Essencial variável", "Supermercado, feira, açougue, padaria, limpeza e higiene", ["Alimentação"]),
    ("Transporte", "Essencial variável", "Combustível, transporte público, estacionamento, pedágio, manutenção do carro", []),
    ("Saúde", "Essencial variável", "Farmácia, consultas, exames, terapia", []),
    ("Casa e manutenção", "Essencial variável", "Reparos, diarista, eletricista, encanador", []),
    ("Impostos e taxas", "Essencial variável", "IPVA, licenciamento, IR a pagar, taxas públicas, multas", []),
    ("Trabalho", "Essencial variável", "Equipamentos, ferramentas, coworking, deslocamentos profissionais", []),
    ("Imprevistos", "Extraordinário", "Emergências e gastos inesperados necessários", []),
    ("Outros", "Extraordinário", "Não classificados — revise e reclassifique depois", []),
    ("Restaurantes e delivery", "Discricionário", "Restaurante, delivery, café, lanches, bares", []),
    ("Lazer e viagens", "Discricionário", "Viagens, passeios, eventos, cinema, shows, hobbies, jogos", ["Lazer"]),
    ("Assinaturas e apps", "Discricionário", "Streaming, música, apps, nuvem, clubes de benefícios", ["Assinaturas"]),
    ("Bem-estar e beleza", "Discricionário", "Academia, cabeleireiro, barbearia, estética, cosméticos", []),
    ("Vestuário", "Discricionário", "Roupas, calçados, acessórios", ["Vestuário e cuidados pessoais"]),
    ("Compras para casa", "Discricionário", "Móveis, decoração, eletrodomésticos, eletrônicos", []),
    ("Cursos e livros", "Discricionário", "Cursos livres, livros, idiomas, certificações", []),
    ("Presentes e família", "Discricionário", "Presentes, datas comemorativas, mesada, apoio familiar", ["Família e presentes"]),
    ("Pets", "Discricionário", "Ração, veterinário, banho e tosa", []),
    ("Reserva de emergência", "Patrimônio", "Aportes na reserva (meta: 6 meses de gastos essenciais)", []),
    ("Investimentos", "Patrimônio", "Aportes, previdência, metas de médio e longo prazo", []),
    ("Empréstimos e financiamentos", "Dívidas e juros", "Parcelas de empréstimos, financiamentos e acordos", ["Dívidas"]),
    ("Juros e tarifas", "Dívidas e juros", "Juros, IOF, anuidade de cartão, tarifas bancárias, multa por atraso", ["Financeiro"]),
]

DEBT_CATEGORY = "Empréstimos e financiamentos"
SCOPES = {
    "Empréstimos e financiamentos": Category.DEBT,
    "Investimentos": Category.INVESTMENT,
    "Reserva de emergência": Category.INVESTMENT,
}


def _rename_or_get(model, user, name, aliases, **filters):
    """Retorna o objeto `name`; se só existir um alias antigo, renomeia no lugar."""
    obj = model.objects.filter(user=user, name=name, **filters).first()
    if obj:
        return obj, []
    olds = list(model.objects.filter(user=user, name__in=aliases, **filters))
    if olds:
        obj = olds[0]
        obj.name = name
        return obj, olds[1:]
    return model(user=user, name=name), []


@transaction.atomic
def apply_default_structure(user):
    """Cria ou reorganiza a estrutura padrão sem perder lançamentos.

    Grupos antigos são renomeados no lugar (ou mesclados, se o novo já existir);
    grupos criados pelo usuário fora da lista padrão são mantidos.
    """
    blocks = {}
    for order, (name, pct, color, aliases) in enumerate(BLOCKS):
        block, _ = _rename_or_get(Block, user, name, aliases)
        block.kind, block.value, block.color, block.order = Block.PERCENT, pct, color, order
        block.save()
        blocks[name] = block

    natures = {}
    for order, (name, block_name) in enumerate(NATURES):
        nature, _ = _rename_or_get(Nature, user, name, [])
        nature.block, nature.order = blocks[block_name], order
        nature.save()
        natures[name] = nature

    for name, nature_name, description, aliases in CATEGORIES:
        category, duplicates = _rename_or_get(Category, user, name, aliases)
        category.nature, category.description, category.active = natures[nature_name], description, True
        category.scope = SCOPES.get(name, Category.EXPENSE)
        category.save()
        # Se o nome novo já existia junto com o antigo, mescla o antigo nele.
        leftovers = duplicates + list(Category.objects.filter(user=user, name__in=aliases).exclude(pk=category.pk))
        for old in leftovers:
            Expense.objects.filter(category=old).update(category=category)
            RecurringExpense.objects.filter(category=old).update(category=category)
            old.delete()

    # Blocos antigos que ficaram sem naturezas não servem mais.
    Block.objects.filter(user=user, natures__isnull=True).exclude(pk__in=[b.pk for b in blocks.values()]).delete()


def seed_user_defaults(user):
    """Cria a estrutura padrão para um usuário que ainda não tem blocos."""
    if Block.objects.filter(user=user).exists():
        return False
    apply_default_structure(user)
    return True
