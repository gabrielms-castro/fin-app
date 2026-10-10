# Fin App

Controle de finanças pessoais: lançamentos (dinheiro, débito, pix, crédito, boleto), cartões com
faturas calculadas pelo dia de fechamento, compras parceladas e dívidas com projeção, receitas
(esperado × recebido), contas fixas, assinaturas e orçamento por blocos (Utilizado / Orçamento / Remanescente).

Stack: Django 5.2 + Django REST Framework + SQLite; frontend SPA em JS puro com Tailwind CSS (CDN browser v4),
ícones Lucide e Chart.js. Os componentes visuais (`.card`, `.btn`, `.input`, `.badge`…) ficam em
`templates/partials/head.html`.

## Conceitos

- **Bloco** – fatia da entrada esperada (% ou valor fixo). Padrão (regra 50/30/20):
  - **Essenciais 50%** ← Essencial fixo, Essencial variável, Extraordinário
  - **Estilo de vida 30%** ← Discricionário
  - **Prioridades financeiras 20%** ← Patrimônio, Dívidas e juros
- **Natureza** – classifica o gasto; cada natureza aponta para um bloco.
- **Grupo de gasto** – Moradia, Mercado, Restaurantes e delivery… cada grupo pertence a uma única natureza, sem sobreposição.
- **Natureza e bloco são automáticos**: o lançamento guarda só o grupo; natureza e bloco vêm da configuração do grupo.
- **Uso do grupo** – *Gastos* (lançamentos, contas fixas, assinaturas), *Dívidas* (só na aba Dívidas) ou
  *Investimentos* (só na aba Investimentos). A API recusa combinações erradas.
- **Assinaturas / contas fixas** – cobranças recorrentes mensais ou anuais (anual renova no mês de início).
- **Investimentos** – cada investimento tem aportes, resgates e rendimentos. Aportes entram no orçamento do mês
  (bloco do grupo, normalmente Prioridades financeiras); resgates e rendimentos só mudam o saldo.
  "Atualizar saldo" registra a diferença para o saldo informado como rendimento.
- **Competência** – mês em que o gasto entra no orçamento. Crédito: mês de vencimento da fatura. Demais formas: data da compra/vencimento.
- **Fatura** – compra antes do dia de fechamento entra na fatura que fecha no mês; no dia do fechamento ou depois, na seguinte. Pagar a fatura apenas marca as parcelas como pagas (não lance o pagamento da fatura como gasto, senão conta em dobro).
- **Recorrentes** – lançados automaticamente até o mês atual; meses futuros aparecem só na projeção.
- **Entrada esperada** – soma das fontes de receita ativas, ou valor definido para o mês no dashboard ("editar").

Blocos, naturezas e grupos padrão são criados automaticamente para cada usuário novo e podem ser alterados em *Configurações*.

## Desenvolvimento

Python 3.13 (mesma versão usada no PythonAnywhere; o projeto também roda em 3.12).

```bash
python3.13 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
echo "DEBUG=True" > .env        # sem isso o app exige SECRET_KEY (modo produção)
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
python manage.py test finance
```

Para um usuário criado antes da configuração padrão existir: `python manage.py seed_defaults --user <username>`.
Para reorganizar uma conta existente na estrutura atual (renomeia/mescla grupos e migra os lançamentos):
`python manage.py seed_defaults --user <username> --restructure` — ou o botão **Aplicar estrutura 50/30/20** em Configurações.

## Deploy no PythonAnywhere

1. Console Bash:
   ```bash
   git clone <repo> ~/fin-app && cd ~/fin-app
   python3.13 -m venv .venv && source .venv/bin/activate
   pip install -r requirements.txt
   cp .env.example .env   # edite SECRET_KEY, ALLOWED_HOSTS, CSRF_TRUSTED_ORIGINS
   python -c "import secrets; print(secrets.token_urlsafe(50))"   # gera SECRET_KEY
   python manage.py migrate
   python manage.py createsuperuser
   python manage.py collectstatic --noinput
   ```
2. Aba **Web** → *Add a new web app* → *Manual configuration* → Python 3.13 (mesma versão do virtualenv).
3. **Virtualenv**: `/home/<usuario>/fin-app/.venv`.
4. **WSGI configuration file** (substitua o conteúdo):
   ```python
   import os, sys
   path = "/home/<usuario>/fin-app"
   if path not in sys.path:
       sys.path.insert(0, path)
   os.environ["DJANGO_SETTINGS_MODULE"] = "config.settings"
   from django.core.wsgi import get_wsgi_application
   application = get_wsgi_application()
   ```
   (o `.env` é carregado pelo `settings.py`).
5. **Static files**: URL `/static/` → diretório `/home/<usuario>/fin-app/staticfiles`.
6. Ative *Force HTTPS* e clique em **Reload**.

Para atualizar: `git pull && pip install -r requirements.txt && python manage.py migrate && python manage.py collectstatic --noinput` e **Reload**.
