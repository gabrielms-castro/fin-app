# PRD: Detalhes de lançamentos, abas de parcelamento e orçamento pelo dinheiro real

## 1. Introdução

Este PRD agrupa quatro melhorias, duas de interface e duas de regra de orçamento:

1. **Modal de detalhes do lançamento.** Hoje cada linha em Lançamentos (`static/js/views/lancamentos.js`) tem botões soltos de editar e excluir, e não há como ver os detalhes completos de uma compra. Na tela de um cartão (`/#/cartoes/{id}`, renderizada por `static/js/views/faturas.js`) as linhas da fatura **não têm ação nenhuma**: não dá para ver nem editar o lançamento. Ao clicar em uma linha, nas duas telas, deve abrir um modal com os detalhes e os botões **Editar** e **Excluir**.
2. **Abas Geral / À vista / Parcelados.** O filtro "Parcelamento" escondido no painel de filtros de Lançamentos vira uma barra de abas visível, e a mesma barra aparece na tela do cartão para separar os itens da fatura.
3. **Orçamento baseado no que foi recebido.** Hoje a base dos blocos (50/30/20 etc.) é sempre a renda **esperada** (`expected_income` em `finance/services/budget.py`). Quando o usuário lança um recebimento, o valor real deve substituir o esperado daquela fonte. Exemplo: salário esperado R$ 6.000,00, recebido R$ 6.259,00, então a base do mês passa a ser R$ 6.259,00.
4. **Sobra do mês vai para o mês seguinte.** O dinheiro real que sobrar em um mês (recebido − gasto) passa para o mês seguinte como **saldo livre**, separado dos blocos. O usuário pode, a qualquer momento, destinar parte dele a uma Meta ou a um Investimento. O que for destinado sai do saldo.

## 2. Objetivos

- Ver os detalhes de qualquer lançamento com 1 clique, tanto em Lançamentos quanto na tela do cartão.
- Editar e excluir lançamentos a partir da tela do cartão (hoje não é possível).
- Trocar entre Geral / À vista / Parcelados com 1 clique, sem abrir o painel de filtros.
- A base de orçamento do mês reflete o valor recebido assim que um recebimento é lançado, fonte a fonte.
- O dashboard mostra o saldo herdado do mês anterior e o saldo livre atual, separados dos blocos.
- O usuário consegue mandar parte do saldo livre para uma Meta ou um Investimento em menos de 30 segundos.
- Nenhuma regressão na projeção, no teto de parcelados e nos testes existentes.

## 3. User Stories

### US-001: Componente de modal de detalhes do lançamento
**Descrição:** Como usuário, quero clicar em um lançamento e ver todos os seus detalhes para entender a compra sem abrir o formulário de edição.

**Critérios de aceite:**
- [ ] Novo módulo `static/js/components/expense-detail.js` exportando `openExpenseDetail({ expenseId, installmentId, onChange })`
- [ ] O modal busca `GET /api/expenses/{id}/` e as parcelas da compra (`GET /api/installments/?expense={id}`; se o filtro `expense` não existir em `InstallmentFilter`, adicioná-lo)
- [ ] Exibe: descrição, tipo (compra/dívida/recorrente/investimento), data da compra, valor total, nº de parcelas e valor da parcela, forma de pagamento, cartão (se houver), categoria → natureza → bloco (com a cor do bloco), credor e juros (só para dívidas), observações (se houver)
- [ ] Exibe a lista de parcelas (nº/total, competência, vencimento, valor, status pago/pendente) e destaca a parcela de onde o usuário clicou (`installmentId`)
- [ ] Rodapé com os botões **Editar** e **Excluir**
- [ ] **Editar** fecha o detalhe e abre `openExpenseForm({ expense })` (`static/js/views/expense-form.js`); ao salvar, chama `onChange()`
- [ ] **Excluir** pede confirmação com `confirmDialog("Excluir este lançamento e todas as suas parcelas?")`, faz `DELETE /api/expenses/{id}/`, mostra `toast` e chama `onChange()`
- [ ] Para lançamentos com tela própria (recorrentes, dívidas, investimentos, os mesmos tipos de `OWN_TAB` em `lancamentos.js`), o modal mostra os detalhes, **não** mostra Editar/Excluir e mostra um link "Abrir em {Assinaturas/Dívidas/Investimentos}" para a tela correspondente
- [ ] Testes e lint passam
- [ ] Verificar no navegador usando a skill dev-browser

### US-002: Abrir o detalhe a partir de Lançamentos
**Descrição:** Como usuário, quero clicar em uma linha de Lançamentos para abrir o modal de detalhes.

**Critérios de aceite:**
- [ ] Clicar em qualquer área da linha (`.list-row`) que não seja um botão abre `openExpenseDetail` com o `expense` e o `id` da parcela
- [ ] Os botões de editar/excluir (`editDelete()`) e o link `arrow-up-right` saem da linha, e essas ações passam a ficar só no modal
- [ ] O botão de marcar pago/pendente continua na linha e **não** abre o modal ao ser clicado
- [ ] A linha tem `cursor-pointer`, um estado de hover e é acessível por teclado (`tabindex="0"`, Enter abre o modal)
- [ ] Após editar ou excluir no modal, a lista e os totais recarregam mantendo filtros e mês
- [ ] Testes e lint passam
- [ ] Verificar no navegador usando a skill dev-browser

### US-003: Abrir o detalhe a partir da tela do cartão
**Descrição:** Como usuário, quero clicar em um item da fatura em `/#/cartoes/{id}` para ver, editar ou excluir o lançamento.

**Critérios de aceite:**
- [ ] Cada linha de item da fatura em `faturas.js` é clicável e abre `openExpenseDetail` (mesmo comportamento de cursor, hover e teclado da US-002)
- [ ] Após editar ou excluir, a fatura selecionada **e** a timeline de faturas recarregam (o total da fatura pode mudar)
- [ ] Se a edição mover a compra para outro cartão, ela some da fatura atual após recarregar
- [ ] Testes e lint passam
- [ ] Verificar no navegador usando a skill dev-browser

### US-004: Abas Geral / À vista / Parcelados em Lançamentos
**Descrição:** Como usuário, quero alternar rapidamente entre todos os lançamentos, só os à vista e só os parcelados.

**Critérios de aceite:**
- [ ] Novo helper `segmented(name, options, value)` em `static/js/ui.js` que renderiza um controle de abas (botões com `aria-pressed`), reutilizável
- [ ] Em Lançamentos, a barra **Geral | À vista | Parcelados** fica acima da lista, sempre visível
- [ ] O campo "Parcelamento" é **removido** de `filterSpecs()`; a chave `parcelado` continua em `FILTER_KEYS`/estado (Geral = vazio, À vista = `false`, Parcelados = `true`), então a URL e o backend (`filter_parcelado`) seguem iguais
- [ ] A aba não conta no contador de filtros ativos (`activeCount`)
- [ ] Trocar de aba recarrega a lista a partir da página 1 e atualiza os totais
- [ ] "Limpar filtros" volta a aba para Geral
- [ ] Testes e lint passam
- [ ] Verificar no navegador usando a skill dev-browser

### US-005: Abas Geral / À vista / Parcelados na tela do cartão
**Descrição:** Como usuário, quero separar os itens da fatura do cartão entre à vista e parcelados.

**Critérios de aceite:**
- [ ] A mesma barra (`segmented`) aparece no card da fatura em `faturas.js`, acima da lista de itens
- [ ] O filtro é feito no cliente sobre os itens já carregados da fatura, com o mesmo critério do backend: parcelado = `installments_count > 1` e `kind !== "divida"`; à vista = o resto
- [ ] Cada aba mostra a quantidade de itens, ex.: "Parcelados (4)"
- [ ] Abaixo da barra aparece o subtotal da aba (o total da fatura no cabeçalho não muda)
- [ ] A aba escolhida se mantém ao trocar de fatura na timeline e volta para Geral ao sair da tela
- [ ] Estado vazio por aba: "Nenhuma compra parcelada nesta fatura." / "Nenhuma compra à vista nesta fatura."
- [ ] Testes e lint passam
- [ ] Verificar no navegador usando a skill dev-browser

### US-006: Base de orçamento pelo valor recebido (fonte a fonte)
**Descrição:** Como usuário, quero que, ao lançar um recebimento, o orçamento do mês use o valor que realmente recebi.

**Critérios de aceite:**
- [ ] Nova função `budget_income(user, month)` em `finance/services/budget.py` que retorna `{"base", "received", "pending_expected", "expected"}`
- [ ] Regra sem `MonthPlan` no mês:
  - para cada `IncomeSource` ativa no mês: se existe `Income` com `source` = essa fonte e data no mês, soma o **recebido** dessa fonte; senão, soma o **esperado** (`amount`)
  - todos os `Income` sem fonte no mês entram como recebido, mas **primeiro cobrem o esperado ainda pendente** (fontes não recebidas ou o que falta do `MonthPlan`); só o excedente soma como extra, para o mesmo dinheiro não contar duas vezes
  - `base = recebido total + esperado das fontes ainda não recebidas`
- [ ] Regra com `MonthPlan` no mês (o usuário ajustou o esperado manualmente): `pending_expected = max(plan.expected_income − soma do amount esperado das fontes já recebidas, 0)` e `base = recebido total + pending_expected`
- [ ] Exemplos cobertos por teste:
  - fonte Salário 6000, recebido 6259 → base 6259
  - Salário 6000 recebido 6259 + Freela 1000 ainda não recebido → base 7259
  - Salário 6000 recebido só 5800 → base 5800 (recebeu menos, orçamento encolhe)
  - nenhum recebimento → base = esperado (comportamento atual)
  - recebimento sem fonte de 300 + Salário 6000 pendente → base 6000 (os 300 cobrem parte do esperado); quando o salário cair com fonte → base 6300
  - `MonthPlan` 5000, sem fontes, recebimento sem fonte de 5000 → base 5000 (não 10000)
- [ ] `month_summary` passa a usar `base` para calcular o orçamento dos blocos (`_block_rows`), o `balance_expected` e o teto de parcelados (`installments_commitment`)
- [ ] `month_summary` continua devolvendo `expected_income` (o planejado) e passa a devolver também `budget_base`
- [ ] `projection` usa `budget_income(...)["base"]` em cada mês (meses futuros sem recebimento continuam iguais ao esperado)
- [ ] Testes existentes de `test_budget.py` continuam passando (ajustar só os que dependiam explicitamente do esperado em mês com recebimento)
- [ ] Testes e lint passam

### US-007: Mostrar a base de orçamento no dashboard
**Descrição:** Como usuário, quero ver no dashboard que o orçamento do mês está usando o valor recebido.

**Critérios de aceite:**
- [ ] O KPI de renda do dashboard mostra `budget_base` como valor principal, com o subtítulo "esperado R$ X · recebido R$ Y"
- [ ] Quando `budget_base ≠ expected_income`, aparece um badge "ajustado pelo recebido"
- [ ] O modal de editar o valor esperado do mês continua editando o `MonthPlan` (sem mudança de comportamento)
- [ ] Testes e lint passam
- [ ] Verificar no navegador usando a skill dev-browser

### US-008: Cálculo do saldo livre com rolagem entre meses
**Descrição:** Como usuário, quero que o dinheiro real que sobrou de um mês fique disponível no mês seguinte.

**Critérios de aceite:**
- [ ] Nova função `free_balance(user, month)` em novo módulo `finance/services/surplus.py` que retorna `{"carry_in", "received", "spent", "allocated", "available"}`
- [ ] Definições, para cada mês M:
  - `received(M)` = soma de `Income` com data em M
  - `spent(M)` = mesmo valor de `spent` do `month_summary` (todas as parcelas da competência M, pagas e pendentes, mais as ocorrências virtuais de recorrentes)
  - `allocated(M)` = soma das `SurplusAllocation` de M (US-009)
  - `available(M) = carry_in(M) + received(M) − spent(M) − allocated(M)`
  - `carry_in(M) = available(M − 1)`; no primeiro mês da série é 0
- [ ] O primeiro mês da série é o mês do `Income` mais antigo do usuário; sem nenhum `Income`, tudo é 0
- [ ] O valor é **calculado na hora**, não armazenado: editar um lançamento ou recebimento de um mês passado recalcula todos os meses seguintes
- [ ] Saldo negativo também rola (o mês seguinte começa devendo); ver Questões em aberto
- [ ] A sobra **não** entra no orçamento dos blocos: `budget_base` e os percentuais de bloco não mudam com `carry_in`
- [ ] `month_summary` passa a incluir `free_balance` com os campos acima
- [ ] Testes: mês único sem rolagem; dois meses com sobra positiva rolando; sobra negativa; edição retroativa alterando o mês seguinte; usuário sem recebimentos
- [ ] Testes e lint passam

### US-009: Modelo e API para destinar a sobra
**Descrição:** Como desenvolvedor, preciso registrar quando o usuário destina parte do saldo livre a uma Meta ou a um Investimento.

**Critérios de aceite:**
- [ ] Novo modelo `SurplusAllocation(Owned)` em `finance/models.py`: `competence` (DateField, 1º dia do mês), `amount` (Decimal > 0), `goal` (FK `Goal`, null), `investment` (FK `Investment`, null), `movement` (OneToOne `InvestmentMovement`, null, `on_delete=SET_NULL`), `notes` (CharField blank), `created_at`
- [ ] Validação: exatamente um destino, `goal` **ou** `investment`
- [ ] Validação: `amount ≤ available` do mês no momento da criação (erro 400 "Valor maior que o saldo livre disponível")
- [ ] Destino **Investimento**: cria um `InvestmentMovement` do tipo `aporte` **sem** `Expense` vinculada (para não contar como gasto nem consumir bloco) e liga em `movement`
- [ ] Destino **Meta ligada a investimento**: comporta-se como destino Investimento usando `goal.investment`, mantendo também `goal` preenchido
- [ ] Destino **Meta sem investimento**: `goal_progress` (`finance/services/goals.py`) passa a somar `initial_amount + soma das SurplusAllocation da meta`
- [ ] Excluir uma `SurplusAllocation` exclui também o `InvestmentMovement` criado por ela e devolve o valor ao saldo livre
- [ ] Endpoint `/api/surplus-allocations/` (list/create/destroy, filtro `month`), isolado por usuário como os demais ViewSets (incluir caso em `test_isolation.py`)
- [ ] Migration gerada com `manage.py makemigrations`
- [ ] Testes e lint passam

### US-010: Card "Saldo livre" no dashboard com ação de destinar
**Descrição:** Como usuário, quero ver quanto dinheiro real tenho livre e mandar parte dele para uma meta ou um investimento.

**Critérios de aceite:**
- [ ] Novo card "Saldo livre" no dashboard, separado do card de blocos, mostrando: "Saldo do mês anterior" (`carry_in`), "+ Recebido", "− Gasto", "− Destinado", "= Disponível"
- [ ] `available` negativo aparece em vermelho (`signClass`); positivo em verde
- [ ] Botão **Destinar** (desabilitado se `available ≤ 0`) abre um modal com: destino (select agrupado "Metas" / "Investimentos", só os ativos), valor (padrão = `available`), observação
- [ ] Ao salvar, chama `POST /api/surplus-allocations/`, mostra `toast`, recarrega o dashboard; erros de validação aparecem no campo (`showErrors`)
- [ ] Lista das destinações do mês dentro do card, cada uma com botão de excluir (com `confirmDialog`)
- [ ] A tela de Metas reflete o novo progresso após destinar a uma meta
- [ ] Testes e lint passam
- [ ] Verificar no navegador usando a skill dev-browser

## 4. Requisitos funcionais

- FR-1: Clicar em uma linha de lançamento, em Lançamentos ou na tela do cartão, deve abrir um modal com todos os detalhes da compra e a lista de parcelas.
- FR-2: Editar e Excluir devem existir **apenas** dentro do modal; a linha mantém só o botão de marcar pago/pendente.
- FR-3: Editar ou excluir uma compra parcelada age sobre a compra inteira (todas as parcelas), como hoje.
- FR-4: Lançamentos de recorrentes, dívidas e investimentos mostram detalhes no modal, com link para a tela própria e sem Editar/Excluir.
- FR-5: Lançamentos e a tela do cartão devem ter a barra Geral / À vista / Parcelados, com o critério "parcelado = 2+ parcelas e não é dívida".
- FR-6: O filtro "Parcelamento" deve ser removido do painel de filtros de Lançamentos.
- FR-7: A base de orçamento do mês deve ser `recebido + esperado das fontes ainda não recebidas` (com o ajuste de `MonthPlan` descrito na US-006).
- FR-8: Blocos, saldo previsto, teto de parcelados e projeção devem usar essa base.
- FR-9: O sistema deve calcular, para cada mês, `disponível = saldo anterior + recebido − gasto − destinado`, rolando o resultado para o mês seguinte.
- FR-10: O saldo livre nunca deve alterar o orçamento dos blocos.
- FR-11: O usuário deve poder destinar parte do saldo livre a uma Meta ou a um Investimento, até o limite do disponível, e desfazer a destinação.
- FR-12: Destinar a um Investimento cria um aporte que não conta como gasto do mês.

## 5. Fora do escopo

- Fechamento de mês obrigatório ou assistente perguntando o destino da sobra (a rolagem é automática).
- Distribuir a sobra entre os blocos ou somá-la à renda base.
- Saldo de conta bancária real, conciliação ou integração com bancos.
- Destinar a sobra para "gastar" com algo específico (gastar já reduz o saldo naturalmente).
- Edição de destinações (só criar e excluir).
- Abas Geral / À vista / Parcelados na lista de cartões (`/#/cartoes`).
- Mudança de modelo ou de cálculo de parcelas, faturas ou recorrentes.

## 6. Considerações de design

- Reaproveitar `openModal`, `confirmDialog`, `toast` (`static/js/components/modal.js`), `openExpenseForm` (`expense-form.js`), `statusBadge`, `kpi`, `empty` (`static/js/ui.js`) e as classes existentes `badge`, `list-row`, `btn`, `card`.
- Modal de detalhes: cabeçalho com descrição + valor grande; grid de 2 colunas com os campos; lista de parcelas compacta abaixo; rodapé com Excluir (estilo perigo, à esquerda) e Editar (primário, à direita).
- A barra de abas deve funcionar em celular (largura total, botões de mesma largura).
- Card "Saldo livre" com o mesmo visual dos KPIs do dashboard; as linhas do cálculo em formato de extrato (rótulo à esquerda, valor `num` à direita).

## 7. Considerações técnicas

- `/#/cartoes/:id` é montada por `faturas.js` (ver `static/js/app.js:46`); o modal deve ser um componente compartilhado, não duplicado nas duas telas.
- A linha de Lançamentos representa uma **parcela** (`Installment`); o modal precisa do `expense` (já presente em `data-expense`) para buscar a compra.
- `filter_parcelado` em `finance/filters.py` e `INSTALLMENT_PURCHASE` em `budget.py` definem o critério de parcelado; o filtro do cliente na tela do cartão deve espelhar esse critério.
- `InvestmentMovement` já tem relação opcional com `Expense`; aportes normais criam Expense (contam como gasto). As destinações de sobra **não** devem criar Expense. `InvestmentMovement.expense` já é `null=True` (`finance/models.py:308`); confirmar que `investments_summary` não depende de a Expense existir.
- `free_balance` itera do primeiro mês com recebimento até o mês pedido. Para evitar N consultas por mês, agregar `Income`, `Installment` e `SurplusAllocation` por competência em poucas queries e somar em Python; as ocorrências virtuais de recorrentes (`virtual_occurrences`) só existem para meses ainda não materializados.
- Seguir as convenções do projeto: migrations via `manage.py makemigrations`, testes em `finance/tests/` com `factories.py`.

## 8. Métricas de sucesso

- Ver os detalhes de um lançamento leva 1 clique, e editar a partir da tela do cartão leva 2 cliques (hoje é impossível).
- Trocar entre À vista e Parcelados leva 1 clique (hoje leva 3: abrir filtros, escolher, aplicar).
- Em mês com recebimento diferente do esperado, o orçamento dos blocos no dashboard bate com o valor recebido.
- A soma de `available` rolado bate com `Σ recebido − Σ gasto − Σ destinado` desde o primeiro mês (teste de invariante).
- Nenhum teste existente quebra.

## 9. Questões em aberto

- **Saldo negativo:** rolar o negativo para o mês seguinte (assumido neste PRD) ou zerar e só rolar sobras positivas?
- **Mês corrente:** a sobra do mês atual já deve aparecer como "disponível para destinar" antes do mês acabar (assumido: sim, com base no recebido e no gasto até agora), ou só depois do mês fechar?
- **Início da série:** começar no primeiro `Income` (assumido) ou permitir que o usuário informe um saldo inicial no onboarding?
- **Recebimento parcial de uma fonte:** se o salário cai em duas partes (ex.: adiantamento + saldo), na primeira parte a fonte já conta como "recebida" e a base encolhe até a segunda chegar. Aceitável, ou a fonte só deveria contar como recebida quando `recebido ≥ esperado` ou no fim do mês?
- O teto de parcelados deve usar a base ajustada (assumido) ou continuar sobre o esperado, para não oscilar durante o mês?
