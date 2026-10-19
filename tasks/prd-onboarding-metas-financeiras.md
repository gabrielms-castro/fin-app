# PRD: Onboarding — proporções de gasto, teto de parcelados e metas financeiras

## 1. Introdução

Hoje, quando um usuário se cadastra, o sistema cria automaticamente três Blocos de orçamento seguindo a regra 50/30/20 (`finance/defaults.py`), mas o usuário nunca é convidado a revisá-los. Além disso, o app não tem nenhum referencial de quanto da renda é saudável comprometer com **compras parceladas**, nem um lugar para registrar **metas financeiras** (reserva de emergência, viagem, entrada de imóvel etc.).

Esta funcionalidade adiciona:

1. **Teto de parcelados**: um percentual ideal da renda mensal que pode estar comprometido com parcelas de compras parceladas (qualquer forma de pagamento, qualquer grupo de gasto). O dashboard mostra quanto está comprometido no mês contra esse teto.
2. **Metas financeiras**: um novo cadastro de metas com valor-alvo e prazo, mostrando progresso e aporte mensal sugerido.
3. **Onboarding (wizard de primeiro login)**: um assistente em 4 passos — renda → proporções → teto de parcelados → metas — que pode ser pulado e refeito depois em Configurações.

## 2. Objetivos

- Todo usuário (novo ou existente) vê o wizard uma única vez e consegue concluí-lo em menos de 3 minutos.
- O usuário escolhe um preset de proporções (ex.: 50/30/20) ou ajusta os percentuais, sempre somando 100%.
- O dashboard mostra, para o mês selecionado, o valor e o % da renda comprometidos com parcelas, com status visual (ok / atenção / estourado).
- O usuário cadastra metas e vê o progresso (%) e quanto precisa guardar por mês para atingi-las no prazo.
- Nenhuma regressão no cálculo atual do dashboard e da projeção.

## 3. User Stories

### US-001: Modelo de configurações do usuário
**Descrição:** Como desenvolvedor, preciso guardar configurações por usuário (teto de parcelados e estado do onboarding) para que persistam entre sessões.

**Critérios de aceite:**
- [ ] Novo modelo `UserSettings` em `finance/models.py` com `user = OneToOneField(AUTH_USER_MODEL, on_delete=CASCADE, related_name="finance_settings")`
- [ ] Campos: `installment_ceiling_pct` (`DecimalField(max_digits=5, decimal_places=2, default=30)`, validadores 0–100), `onboarding_completed_at` (`DateTimeField(null=True, blank=True)`), `onboarding_skipped_at` (`DateTimeField(null=True, blank=True)`)
- [ ] O signal `seed_new_user` (`finance/signals.py`) cria o `UserSettings` junto com os defaults
- [ ] Migration de dados cria `UserSettings` para todos os usuários existentes, com os dois campos de onboarding nulos (assim eles também veem o wizard uma vez)
- [ ] Helper `get_settings(user)` usa `get_or_create` (nunca falha para usuário sem registro)
- [ ] Registrado no admin
- [ ] `python manage.py makemigrations --check` não acusa pendências; testes passam

### US-002: API de configurações
**Descrição:** Como frontend, preciso ler e alterar as configurações do usuário logado.

**Critérios de aceite:**
- [ ] `GET /api/settings/` retorna `{installment_ceiling_pct, onboarding_completed_at, onboarding_skipped_at, onboarding_pending}`
- [ ] `PATCH /api/settings/` aceita `installment_ceiling_pct`; valores < 0 ou > 100 retornam 400
- [ ] `POST /api/settings/onboarding/complete/` define `onboarding_completed_at = now()`; `POST /api/settings/onboarding/skip/` define `onboarding_skipped_at = now()`; `POST /api/settings/onboarding/reset/` zera ambos
- [ ] `onboarding_pending` = `True` somente quando os dois campos são nulos
- [ ] O endpoint `meta` (`finance/views.py`) passa a incluir `onboarding_pending`
- [ ] Teste em `test_isolation.py`: o usuário A não lê nem altera as configurações do usuário B
- [ ] Testes passam

### US-003: Cálculo do comprometimento com parcelados
**Descrição:** Como usuário, quero saber quanto da minha renda do mês está comprometido com compras parceladas.

**Critérios de aceite:**
- [ ] Nova função em `finance/services/budget.py`: `installments_commitment(user, month)`
- [ ] Soma `Installment.amount` com `competence == month` e `expense.installments_count > 1`, excluindo `expense.kind == "divida"` (ver Perguntas em aberto), para qualquer `payment_method`
- [ ] Renda = `expected_income(user, month)` (já existente)
- [ ] Retorna `{committed, pct, ceiling_pct, ceiling_amount, status}`, onde:
  - `pct = committed / renda * 100` (0 se a renda for 0), com `quantize(Decimal("0.01"))`
  - `ceiling_amount = renda * ceiling_pct / 100`
  - `status = "ok"` se `pct < 80% do teto`; `"warning"` se `80% do teto ≤ pct ≤ teto`; `"over"` se `pct > teto`
  - Exemplo: renda 10.000, teto 30%, parcelas no mês 2.700 → pct 27, ceiling_amount 3.000, status `warning`
- [ ] `month_summary` inclui a chave `installments_commitment` com esse objeto
- [ ] Cálculo numa única query agregada (`aggregate(Sum)`)
- [ ] Testes em `test_budget.py`: compra à vista (1x) não conta; compra 3x conta só a parcela da competência; dívida não conta; renda 0 não quebra; os três status

### US-004: Indicador de parcelados no dashboard
**Descrição:** Como usuário, quero ver no dashboard se estou dentro do teto de parcelados.

**Critérios de aceite:**
- [ ] Card "Parcelados no mês" em `static/js/views/dashboard.js` com: valor comprometido (R$), % da renda, teto (% e R$) e uma barra de progresso
- [ ] Cor da barra: verde (`ok`), amarelo (`warning`), vermelho (`over`)
- [ ] Texto auxiliar quando `over`: "R$ X acima do teto"
- [ ] O card respeita o mês selecionado e o estado de carregamento existente (skeleton/spinner)
- [ ] Testes passam
- [ ] Verify in browser using dev-browser skill

### US-005: Aviso ao lançar compra parcelada
**Descrição:** Como usuário, quero ser avisado antes de salvar uma compra parcelada que me faria passar do teto.

**Critérios de aceite:**
- [ ] Em `static/js/views/expense-form.js`, quando `installments_count > 1`, o formulário mostra um aviso (não bloqueante) se `committed + valor da parcela > ceiling_amount` em algum mês afetado pelas parcelas
- [ ] Dados vêm de um endpoint `GET /api/installments-commitment/?months=YYYY-MM,...` ou do cálculo do dashboard para os meses envolvidos
- [ ] O aviso diz qual mês estoura e por quanto
- [ ] Salvar continua permitido
- [ ] Testes passam
- [ ] Verify in browser using dev-browser skill

### US-006: Modelo e API de metas
**Descrição:** Como desenvolvedor, preciso de um cadastro de metas financeiras.

**Critérios de aceite:**
- [ ] Modelo `Goal(Owned)` com: `name` (CharField 80), `target_amount` (Decimal 14,2, > 0), `target_date` (DateField, opcional), `initial_amount` (Decimal 14,2, default 0), `investment` (FK `Investment`, `SET_NULL`, opcional), `color` (CharField 9, default `#10b981`), `active` (bool, default True), `order` (PositiveSmallInteger), `created_at`
- [ ] `GoalViewSet` registrado em `finance/urls.py` como `goals`, filtrando pelo usuário (mesmo padrão dos outros viewsets)
- [ ] Validação: `investment` precisa pertencer ao mesmo usuário; `target_date`, se informado, não pode estar no passado na criação
- [ ] Testes de API e de isolamento passam

### US-007: Progresso e aporte mensal sugerido
**Descrição:** Como usuário, quero saber quanto já juntei e quanto preciso guardar por mês.

**Critérios de aceite:**
- [ ] O serializer de `Goal` expõe campos calculados `saved`, `progress_pct`, `remaining`, `months_left` e `suggested_monthly`
- [ ] `saved` = `investments.balance(investment)` (de `finance/services/investments.py`) se houver investimento vinculado; senão `initial_amount`
- [ ] `progress_pct` = `min(saved / target_amount * 100, 100)`
- [ ] `months_left` = meses entre o mês atual e `target_date` (mínimo 1); `null` sem prazo
- [ ] `suggested_monthly` = `remaining / months_left`; `null` sem prazo; 0 se já atingida
- [ ] Exemplo: alvo 12.000, saved 3.000, prazo daqui a 9 meses → `suggested_monthly` 1.000
- [ ] Testes unitários cobrem: com e sem investimento, com e sem prazo, meta já atingida

### US-008: Tela de Metas
**Descrição:** Como usuário, quero listar, criar, editar e arquivar minhas metas.

**Critérios de aceite:**
- [ ] Nova view `static/js/views/metas.js` e rota no `router.js`, com item no menu
- [ ] Lista com nome, barra de progresso (cor da meta), `saved / target`, prazo e "Guardar R$ X/mês"
- [ ] Criar e editar via `components/modal.js` + `components/form.js`; o select de investimento usa `store.investments`
- [ ] Arquivar (`active=false`) com confirmação; as arquivadas ficam ocultas por padrão
- [ ] Estado vazio: "Nenhuma meta ainda" + botão "Criar meta"
- [ ] Testes passam
- [ ] Verify in browser using dev-browser skill

### US-009: Esqueleto do wizard de onboarding
**Descrição:** Como novo usuário, quero ser guiado na configuração inicial assim que entro no app.

**Critérios de aceite:**
- [ ] Novo componente `static/js/views/onboarding.js`, aberto por `app.js` após carregar `meta` quando `onboarding_pending === true`
- [ ] Modal em tela cheia com indicador "Passo N de 4", botões Voltar / Avançar / Pular configuração
- [ ] "Pular" chama `POST /api/settings/onboarding/skip/` e fecha; o wizard não reabre em logins seguintes
- [ ] Cada passo salva ao clicar em Avançar (o progresso parcial não se perde se o usuário fechar depois)
- [ ] Avançar mostra spinner (`components/loading.js`) enquanto salva
- [ ] Testes passam
- [ ] Verify in browser using dev-browser skill

### US-010: Passo 1 — Renda mensal
**Descrição:** Como usuário, quero informar minha renda para que os percentuais virem valores em R$.

**Critérios de aceite:**
- [ ] Campo "Renda líquida mensal" (obrigatório para avançar, > 0) e "Dia do recebimento" (default 5)
- [ ] Se o usuário não tiver `IncomeSource` ativa, cria uma com `name="Salário"`, `start_month` = mês atual
- [ ] Se já tiver, mostra a soma atual e permite manter (sem criar duplicata)
- [ ] Testes passam
- [ ] Verify in browser using dev-browser skill

### US-011: Passo 2 — Proporções de gasto
**Descrição:** Como usuário, quero escolher como dividir minha renda entre os blocos.

**Critérios de aceite:**
- [ ] Presets em cards selecionáveis: 50/30/20 (padrão), 60/30/10, 70/20/10, Personalizado — na ordem Essenciais / Estilo de vida / Prioridades financeiras
- [ ] Mostra um campo % por bloco existente do usuário com `kind == "percent"`; selecionar um preset preenche os campos; editar qualquer campo muda a seleção para "Personalizado"
- [ ] Prévia em R$ por bloco (`renda × % / 100`) atualizada em tempo real
- [ ] Indicador de soma; Avançar fica desabilitado enquanto a soma ≠ 100
- [ ] Ao avançar, faz `PATCH /api/blocks/{id}/` de cada bloco alterado
- [ ] Se o usuário tiver um número de blocos percentuais ≠ 3 (blocos customizados), os presets ficam ocultos e só a edição manual aparece
- [ ] Testes passam
- [ ] Verify in browser using dev-browser skill

### US-012: Passo 3 — Teto de parcelados
**Descrição:** Como usuário, quero definir o máximo da renda que aceito comprometer com parcelas.

**Critérios de aceite:**
- [ ] Slider + campo numérico de 0 a 100 (passo 1), default 30
- [ ] Texto: "Até R$ X por mês em parcelas" (renda × teto)
- [ ] Mostra o comprometimento atual do mês, se houver parcelas lançadas
- [ ] Ao avançar, `PATCH /api/settings/`
- [ ] Testes passam
- [ ] Verify in browser using dev-browser skill

### US-013: Passo 4 — Metas financeiras
**Descrição:** Como usuário, quero cadastrar minhas primeiras metas já no onboarding.

**Critérios de aceite:**
- [ ] Sugestão pré-preenchida (pode ser removida): "Reserva de emergência", alvo = 6 × orçamento do bloco "Essenciais" (`Block.budget_for(renda)`), sem prazo
- [ ] Botão "Adicionar meta" com nome, valor-alvo e prazo opcional (form inline)
- [ ] Passo opcional: dá para concluir sem nenhuma meta
- [ ] Ao concluir, cria as metas via `POST /api/goals/` e chama `onboarding/complete/`
- [ ] Testes passam
- [ ] Verify in browser using dev-browser skill

### US-014: Conclusão e refazer onboarding
**Descrição:** Como usuário, quero ver um resumo do que configurei e poder refazer depois.

**Critérios de aceite:**
- [ ] Tela final com resumo: renda, proporções, teto e número de metas; botão "Ir para o dashboard" recarrega o dashboard
- [ ] Em `static/js/views/config.js`, botão "Refazer configuração inicial" chama `onboarding/reset/` e abre o wizard com os valores atuais pré-preenchidos
- [ ] Em Configurações, campo para editar o teto de parcelados fora do wizard
- [ ] Testes passam
- [ ] Verify in browser using dev-browser skill

## 4. Requisitos Funcionais

- FR-1: O sistema deve manter um registro `UserSettings` por usuário, criado no cadastro e via backfill para os usuários existentes.
- FR-2: O teto de parcelados (`installment_ceiling_pct`) deve ser um decimal entre 0 e 100, com padrão 30.
- FR-3: O comprometimento com parcelados de um mês é a soma de `Installment.amount` com `competence` igual ao mês, de despesas com `installments_count > 1` e `kind != "divida"`, de qualquer forma de pagamento e grupo de gasto.
- FR-4: O % comprometido é calculado sobre `expected_income(user, month)`; com renda 0, o % é 0 e o status é `ok` se `committed == 0`, senão `over`.
- FR-5: O status é `ok` abaixo de 80% do teto, `warning` entre 80% e 100% do teto (inclusive) e `over` acima do teto.
- FR-6: Todos os valores monetários e percentuais usam `Decimal` com `quantize(Decimal("0.01"))`.
- FR-7: O dashboard deve exibir o comprometimento com parcelados do mês selecionado.
- FR-8: O formulário de despesa deve avisar (sem bloquear) quando uma compra parcelada faria algum mês passar do teto.
- FR-9: O sistema deve permitir CRUD de metas (`Goal`), isoladas por usuário, com vínculo opcional a um investimento do próprio usuário.
- FR-10: O progresso de uma meta usa o saldo do investimento vinculado, se houver; senão, `initial_amount`.
- FR-11: O aporte mensal sugerido é `(target − saved) / months_left`, com `months_left ≥ 1`; sem prazo, é nulo.
- FR-12: O wizard abre automaticamente quando `onboarding_completed_at` e `onboarding_skipped_at` são nulos.
- FR-13: O wizard tem 4 passos (renda, proporções, teto, metas) e um resumo final; pode ser pulado a qualquer momento.
- FR-14: No passo de proporções, a soma dos percentuais dos blocos `percent` deve ser exatamente 100 para avançar.
- FR-15: O usuário pode refazer o wizard a partir de Configurações.
- FR-16: Todas as rotas novas exigem autenticação e filtram por `request.user`.

## 5. Fora do Escopo

- Uso ideal do limite de cada cartão (% do limite).
- Bloquear lançamentos que passem do teto.
- Notificações por e-mail, push ou lembretes.
- Aporte automático ou transferência de dinheiro para metas.
- Criar, renomear ou remover blocos dentro do wizard (continua em Configurações).
- Várias moedas.
- Histórico do teto ao longo do tempo (vale o valor atual para todos os meses).

## 6. Considerações de Design

- Reutilizar `components/modal.js` (com a animação de abertura já existente), `components/form.js` e `components/loading.js`.
- Usar as cores dos blocos (`Block.color`) na prévia das proporções e na barra do dashboard, quando fizer sentido.
- Os cards de preset mostram a divisão como uma barra empilhada colorida e um rótulo ("Equilibrado 50/30/20", "Conservador 70/20/10" etc.).
- O wizard precisa funcionar na largura de celular (campos em coluna, botões fixos no rodapé).

## 7. Considerações Técnicas

- Modelos novos: `UserSettings` (OneToOne, não herda `Owned` por ser 1:1) e `Goal` (herda `Owned`).
- Backfill de `UserSettings` numa data migration (`RunPython`) com reverse no-op.
- `installments_commitment` faz uma única query agregada; o `month_summary` não deve ganhar queries N+1.
- Para o aviso da US-005, calcular no backend os meses afetados a partir de `first_competence` (já existente em `finance/services/installments.py`), para não duplicar regras de competência no JS.
- `meta` expõe `onboarding_pending` para evitar uma requisição extra no boot.
- Testes novos seguem `finance/tests/factories.py`.

## 8. Métricas de Sucesso

- ≥ 70% dos novos usuários concluem o wizard (e não pulam).
- ≥ 50% dos usuários ativos têm pelo menos uma meta cadastrada.
- Tempo mediano para concluir o wizard < 3 minutos.
- Percentual de meses com status `over` cai ao longo do tempo para quem configurou o teto.

## 9. Perguntas em Aberto

- Dívidas parceladas (`kind = "divida"`, ex.: empréstimo) devem contar no teto? **Proposta:** não contar (são tratadas em Dívidas). Confirmar.
- Parcelados no boleto/carnê contam como parcelados? **Proposta:** sim, qualquer `payment_method`, conforme "independentemente do tipo de gasto". Confirmar.
- Parcelas já pagas na competência continuam contando? **Proposta:** sim (o comprometimento é do mês, não do saldo em aberto).
- O teto deve considerar também o comprometimento futuro (ex.: média dos próximos 3 meses)?
- Contribuições para metas devem gerar lançamentos/movimentos automaticamente ou basta o vínculo com investimento?
