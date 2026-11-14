# Ideias de IA, agentes e Machine Learning para o fin-app

Documento de estudo: casos de uso de ML clássico, LLMs e agentes no contexto do app. Cada ideia traz o problema que resolve, os dados que o app já tem, a abordagem técnica, um MVP, como evoluir e o que você aprende com ela.

> **Premissa importante:** hoje o app é pessoal ou de poucos usuários. Isso significa **pouco dado por usuário** e nenhum dado "de população". Várias ideias abaixo foram desenhadas para funcionar com pouco dado (regras + ML simples + LLM) e para crescer conforme o histórico aumenta. Quando o volume não for suficiente para estudar, use **dados sintéticos** (seção 4).

---

## 1. O que o app já oferece como matéria-prima

| Dado | Onde está | Serve para |
|---|---|---|
| Descrição, valor, data, forma de pagamento, cartão | `Expense` | classificação de texto, séries temporais, anomalias |
| Categoria → Natureza → Bloco | `Category`, `Nature`, `Block` | **rótulos prontos** para aprendizado supervisionado |
| Parcelas e competência | `Installment` | previsão de fluxo de caixa |
| Recorrentes e assinaturas | `RecurringExpense` | detecção de recorrência (rótulo pronto) |
| Recebimentos e fontes | `Income`, `IncomeSource` | previsão de renda |
| Metas e investimentos | `Goal`, `Investment`, `InvestmentMovement` | simulação, recomendação de aporte |
| Teto de parcelados, proporções | `UserSettings`, `Block` | restrições para otimização e recomendação |

O ponto mais valioso: **toda despesa já é rotulada pelo usuário** (categoria). Isso é dado supervisionado de graça.

---

## 2. Aprofundando as suas ideias

### 2.1 Assistente de compras de mercado

**Problema:** o usuário não sabe o que comprar no mês nem quanto vai gastar no mercado.

**Mudança de foco sugerida:** em vez de "o que comprar", comece com **"o que provavelmente está acabando e quanto isso vai custar"**. É um problema de **previsão de recompra**, bem definido e mensurável.

**Pré-requisito:** dados no nível de **item** (produto, quantidade, preço unitário, data), o que vem da ideia 2.2 (notas fiscais). Sem isso, o assistente só enxerga "Mercado R$ 487,00".

**Abordagem em camadas:**
1. **Heurística (baseline):** para cada produto, calcular o intervalo médio entre compras e a quantidade média. Se `dias desde a última compra ≥ intervalo médio × 0,9`, o item entra na lista. Isso já é útil e serve de baseline para comparar os modelos.
2. **ML:** modelo de *survival analysis* (tempo até a próxima compra, ex.: `lifelines`) ou classificação "compra este item nos próximos 7 dias?" com features como dias desde a última compra, frequência, quantidade da última compra, dia do mês e se o salário já caiu. Métricas: precisão@k e recall@k da lista sugerida.
3. **LLM por cima:** transforma a lista em algo útil, agrupa por seção do mercado, sugere substituições mais baratas com base no histórico de preços e respeita o orçamento restante do bloco "Essenciais".

**Evoluções:**
- **Orçamento da lista:** soma dos preços previstos (último preço ou média móvel) comparada ao que sobra no bloco do mês. Exemplo de saída: "a lista sugerida custa ~R$ 620; restam R$ 540 no bloco Essenciais".
- **Melhor momento para comprar:** cruzar com a data do recebimento e com o fechamento da fatura do cartão (compras logo após o fechamento ganham ~40 dias de prazo).
- **Inflação pessoal:** variação de preço dos *seus* produtos ao longo do tempo, comparada ao IPCA. É um ótimo gráfico para o dashboard.

**Você aprende:** feature engineering temporal, survival analysis, avaliação de sistemas de recomendação e o padrão "ML decide, LLM explica".

---

### 2.2 OCR da nota fiscal: melhor ainda, **QR Code da NFC-e**

**Problema:** registrar itens comprados é trabalhoso, e sem itens não existem as ideias 2.1 e 3.4.

**Melhoria importante:** no Brasil, toda **NFC-e** (cupom fiscal eletrônico) tem um **QR Code** que aponta para a página da SEFAZ do estado com a **lista estruturada de itens** (descrição, quantidade, unidade, valor unitário, total), além do CNPJ e da razão social do estabelecimento. Ler o QR Code e fazer *parsing* dessa página é **muito mais confiável que OCR**.

**Pipeline sugerido (com fallback):**
1. **QR Code**: decodificar a imagem (`pyzbar`/`opencv`), abrir a URL da SEFAZ e extrair os itens. Cada estado tem um layout diferente, então comece pelo seu.
2. **Fallback com LLM com visão**: se não houver QR legível (nota antiga, cupom amassado, nota de serviço), enviar a foto para um modelo multimodal (ex.: Claude) pedindo **saída estruturada** num JSON Schema: estabelecimento, data, itens, total.
3. **Fallback com OCR clássico** (para estudar): Tesseract/PaddleOCR + regex/parsing. É ótimo para comparar acurácia e custo com o LLM.
4. **Validação:** a soma dos itens precisa bater com o total da nota; se não bater, pedir revisão ao usuário.

**Normalização de produtos (a parte mais rica para ML):** a nota traz `"LEITE INTEG PIRACANJUBA 1L"`, `"LT PIRAC INT 1L"` etc. Para transformar isso em um produto canônico:
- **Entity resolution** com embeddings de texto + clustering ou busca por vizinhos mais próximos (pgvector/FAISS).
- **Classificação hierárquica** do produto (Laticínios → Leite) com um LLM no começo e depois um modelo pequeno treinado nos rótulos que o LLM e o usuário geraram (*distillation*).
- O código **GTIN/EAN**, quando aparece na nota, é uma chave forte para unir produtos.

**Novos modelos de dados:** `Receipt` (nota, estabelecimento, CNPJ, chave de acesso) → `ReceiptItem` (produto bruto, quantidade, preço) → `Product` (canônico). A `Receipt` se liga a uma `Expense` existente (ou cria uma).

**Usos futuros:** as ideias 2.1 e 3.4, comparação de preços entre mercados, "quanto gasto com café por mês" e detecção de *shrinkflation* (mesmo preço, embalagem menor).

**Você aprende:** visão computacional básica, OCR, saída estruturada de LLM, entity resolution, embeddings e *distillation* de LLM para um modelo pequeno.

---

### 2.3 Agente que faz lançamentos por linguagem natural

**Problema:** o formulário de despesa tem muitos campos (categoria, cartão, parcelas, competência…).

**Exemplos de entrada:**
- "gastei 87,50 no ifood ontem no nubank"
- "comprei uma TV de 3 mil em 10x no itaú"
- "recebi o salário, veio 6259"
- "quanto ainda posso gastar com lazer este mês?"

**Arquitetura recomendada: tool use, não text-to-SQL.** O agente **nunca** escreve no banco diretamente; ele chama ferramentas que reaproveitam os serializers e as regras da API:

| Ferramenta | Faz |
|---|---|
| `list_categories`, `list_cards`, `list_income_sources` | dá contexto ao modelo (ids e nomes do usuário) |
| `create_expense(description, amount, date, payment_method, card_id, category_id, installments)` | valida pelo `ExpenseSerializer` |
| `create_income(...)` | idem para recebimentos |
| `get_month_summary(month)` | responde perguntas usando `month_summary` |
| `search_expenses(filters)` | consulta usando os mesmos filtros da API |

**Pontos de projeto que fazem a diferença:**
- **Confirmação antes de escrever:** o agente monta um *rascunho* e a UI mostra um card "Lançar R$ 87,50 · iFood · Nubank · Alimentação → Delivery · 04/11?" com os botões Confirmar/Editar. *Human-in-the-loop* evita lixo no banco.
- **Ambiguidade:** se faltar o cartão ou houver duas categorias plausíveis, o agente pergunta em vez de chutar.
- **Categoria sugerida pelo modelo da ideia 3.1**, e não pelo LLM: o modelo de ML é mais barato, determinístico e personalizado. O LLM fica responsável por extrair os campos.
- **Datas relativas** ("ontem", "sexta passada"): injetar a data atual no prompt e validar no backend.
- **Isolamento por usuário:** as ferramentas recebem `request.user` do servidor, nunca um `user_id` vindo do modelo.
- **Avaliação:** monte um *dataset* de ~100 frases com o JSON esperado e meça acurácia campo a campo (valor, data, categoria, parcelas). Rode a cada mudança de prompt ou modelo, como teste de regressão.

**Evoluções:** entrada por voz (speech-to-text), um bot de Telegram/WhatsApp como canal e lote ("ontem: padaria 12, uber 23, farmácia 54").

**Você aprende:** tool use / function calling, design de ferramentas, *evals* de LLM, *guardrails* e UX de agentes.

---

### 2.4 Padrões de consumo para atingir metas

**Problema:** o usuário tem metas (`Goal`) e um aporte sugerido, mas não sabe **de onde tirar** o dinheiro.

**Reformulação:** responder a três perguntas concretas:
1. **"Vou bater a meta no prazo?"** Projetar o saldo livre (já calculado no PRD de orçamento dinâmico) com incerteza: uma **simulação de Monte Carlo** sobre a distribuição histórica de gastos e recebimentos dá uma **probabilidade**, ex.: "73% de chance de juntar R$ 10.000 até junho".
2. **"Onde estou gastando diferente do meu normal?"** Comparar cada categoria com a própria baseline (mediana dos últimos 6 meses), usando z-score robusto (MAD) e destacando os desvios relevantes.
3. **"O que cortar com menos dor?"** Sugerir cortes em categorias **discricionárias** (bloco "Desejos"), que têm alta variância e onde o histórico mostra que o usuário já gastou menos antes. Exemplo: "em 3 dos últimos 6 meses você gastou < R$ 300 com delivery; manter esse nível libera R$ 180/mês e antecipa a meta Viagem em 2 meses".

**Técnicas:**
- Decomposição de séries por categoria (tendência + sazonalidade: 13º, IPVA, material escolar, Black Friday).
- Clustering de **meses** (k-means sobre o vetor de gastos por categoria) para identificar "tipos de mês" (mês de viagem, mês apertado).
- Um LLM para redigir o relatório a partir de **números já calculados** (nunca deixar o LLM fazer a conta).

**Você aprende:** estatística robusta, simulação, séries temporais e comunicação de incerteza.

---

## 3. Novas ideias

### 3.1 Categorização automática de despesas ⭐ (comece por aqui)
**Por quê:** é o projeto de ML supervisionado mais "puro" do app. Os rótulos já existem (cada `Expense` tem `category`), o retorno é imediato no formulário e o escopo é pequeno.
- **Entrada:** descrição + valor + forma de pagamento + cartão + dia da semana.
- **Baseline:** regra "mesma descrição normalizada → mesma categoria da última vez".
- **Modelo 1:** TF-IDF de caracteres (n-gramas 2–4, que lidam bem com "IFD*IFOOD" ou "UBER *TRIP") + regressão logística. Treina em segundos.
- **Modelo 2:** embeddings de sentenças (ex.: `sentence-transformers` multilíngue) + kNN. Resolve melhor o *cold start*.
- **Modelo 3 (comparação):** LLM *zero-shot* recebendo a lista de categorias do usuário. Compare acurácia, latência e custo com os anteriores.
- **Produto:** o formulário pré-seleciona a categoria com a confiança; se a confiança for baixa, mostra as top-3 opções.
- **Aprendizado contínuo:** cada correção do usuário vira dado de treino; retreino noturno com um management command.
- **Avaliação:** split **temporal** (treina no passado, testa no futuro), acurácia top-1/top-3 e matriz de confusão por natureza.

### 3.2 Previsão de fluxo de caixa e do fechamento do mês
"No ritmo atual, você fecha o mês com −R$ 230". Combina o que já é **certo** (parcelas e recorrentes já lançados, que o `projection` já calcula) com o que é **provável** (gastos variáveis ainda não feitos, previstos por categoria). É um bom estudo de séries temporais pequenas: comece com média móvel e sazonal ingênua, depois teste modelos como ETS/Prophet/`statsforecast` e avalie com MAPE/MAE em backtest.

### 3.3 Detecção de anomalias e alertas
- Valor fora do padrão para aquela categoria ou estabelecimento (isolation forest ou z-score robusto).
- Possível **cobrança duplicada** (mesmo valor e descrição parecida em até 48h).
- Assinatura que **mudou de preço** silenciosamente.
- Gasto em cartão que você quase nunca usa.

Bom exercício de ML não supervisionado e de **ajuste de limiar** (precisão vs. alertas demais).

### 3.4 Detecção de assinaturas esquecidas
Encontrar despesas que se repetem com valor parecido em intervalo regular e **ainda não estão cadastradas** como `RecurringExpense`. Exemplo: "Parece que você paga R$ 39,90 todo dia 12 para 'GOOGLE *YouTube'; cadastrar como assinatura?". Técnicas: agrupamento por descrição normalizada + análise de periodicidade (desvio padrão dos intervalos). As `RecurringExpense` já cadastradas servem de rótulo para avaliar o detector.

### 3.5 Importação de fatura e extrato (PDF/CSV/OFX)
Em vez de lançar uma a uma, importar a fatura do cartão em PDF. Um LLM com saída estruturada extrai as linhas, o modelo da 3.1 categoriza, e a **conciliação** com lançamentos já existentes (mesmo valor ± dias) evita duplicatas. É um projeto excelente de AI engineering: parsing de documento + matching + revisão humana em lote.

### 3.6 Assistente de perguntas sobre as finanças (RAG sobre dados estruturados)
"Quanto gastei com Uber em 2026?", "qual foi meu mês mais caro e por quê?". Use o mesmo agente da 2.3 com ferramentas de **consulta** (agregações prontas) e evite gerar SQL livre. Para perguntas sobre o *próprio app* ("como funciona o teto de parcelados?"), um RAG pequeno sobre `docs/` resolve.

### 3.7 Simulador "e se?"
"E se eu comprar um celular de R$ 4.000 em 12x?" O app já calcula parcelas, competência por fechamento de fatura e teto de parcelados. O simulador cria uma despesa **hipotética** (sem gravar), roda `projection` e o Monte Carlo da 2.4 e mostra o impacto no teto de parcelados e na probabilidade de bater as metas. O LLM entra só na interface de linguagem natural.

### 3.8 Recomendação de alocação da sobra
Conecta com o PRD de orçamento dinâmico: quando há saldo livre, sugerir quanto mandar para cada meta. Começa com regras (reserva de emergência primeiro; depois a meta com prazo mais apertado) e evolui para um **problema de otimização** (programação linear com `scipy`/`pulp`): maximizar a probabilidade de cumprir as metas, sujeito ao saldo e a um colchão mínimo. É um ótimo contato com pesquisa operacional.

### 3.9 Resumo semanal e mensal proativo
Um job semanal que gera um resumo curto: o que mudou, alertas da 3.3, progresso das metas e uma sugestão. O padrão é: **números calculados em Python → LLM só redige**. Vale estudar *prompt caching* (o contexto do usuário se repete) e o custo por usuário/mês.

---

## 4. Dados para estudar quando o seu histórico for pequeno

- **Gerador sintético:** escreva um *management command* (`seed_synthetic`) que cria N usuários fictícios com perfis (renda, proporções, hábitos), sazonalidade, assinaturas, parcelados e ruído nas descrições ("IFD*IFOOD 123", "UBER *TRIP"). Isso já é um projeto de modelagem por si só e garante dados para treinar e avaliar tudo acima.
- **LLM para variar textos:** gerar variações realistas de descrições de estabelecimentos para a 3.1.
- **Dados públicos:** IPCA e cestas de preço (IBGE/DIEESE) para a inflação pessoal; datasets públicos de transações (Kaggle) para pré-treino ou comparação.
- **Os seus próprios dados:** exporte com cuidado. Para notebooks, use uma cópia anonimizada.

---

## 5. Arquitetura sugerida

```
finance/
  ml/
    features.py        # funções puras: queryset → DataFrame
    categorizer.py     # treino/predição da 3.1
    forecasting.py     # 3.2
    anomalies.py       # 3.3
    registry.py        # salva/carrega modelos (joblib) por usuário + versão
  ai/
    tools.py           # ferramentas do agente (reaproveitam serializers/services)
    agent.py           # loop de tool use
    receipts.py        # QR NFC-e + fallback com visão
    evals/             # datasets e scripts de avaliação
  management/commands/
    train_models.py
    seed_synthetic.py
notebooks/             # exploração (fora do pacote do app)
```

- **Funções puras de features**, compartilhadas entre notebook e produção, evitam *training/serving skew*.
- Modelos pequenos (scikit-learn) rodam **dentro do Django**; para tarefas lentas (OCR, LLM, retreino), use uma fila (Celery/RQ ou, no começo, um management command agendado).
- **Cada ideia com LLM ganha um *eval* versionado** antes de ir para a UI.
- **Modelos LLM:** um modelo pequeno e barato (ex.: `claude-haiku-5-5`) para extração e classificação; um modelo maior (ex.: `claude-sonnet-5-5`) para o agente conversacional e os relatórios. Compare os dois nos seus *evals*.

---

## 6. Privacidade e cuidados

- Dados financeiros são sensíveis (LGPD): deixe claro quando algo é enviado a um provedor de LLM, envie o **mínimo** necessário (ex.: descrição e valor, sem nome nem CPF) e ofereça um modo sem IA.
- O LLM **nunca** faz conta nem decide valores gravados: o cálculo é do backend e a escrita passa por validação e confirmação.
- Sugestões financeiras são **informativas**; evite tom de recomendação de investimento.
- Registre a versão do modelo ou prompt em cada sugestão para poder auditar e comparar.

---

## 7. Roteiro de estudo sugerido

| Ordem | Projeto | Foco principal | Esforço |
|---|---|---|---|
| 1 | 3.1 Categorização automática | ML supervisionado, avaliação, baseline | baixo |
| 2 | 4. Gerador de dados sintéticos | modelagem de dados, distribuições | baixo/médio |
| 3 | 2.3 Agente de lançamentos | tool use, evals, guardrails | médio |
| 4 | 3.4 + 3.3 Assinaturas e anomalias | não supervisionado, limiares | médio |
| 5 | 3.2 Previsão do fechamento do mês | séries temporais, backtest | médio |
| 6 | 2.2 NFC-e + OCR | visão, extração estruturada, entity resolution | alto |
| 7 | 2.1 Assistente de mercado | survival analysis, recomendação | alto |
| 8 | 2.4 + 3.7 + 3.8 Metas, simulação e alocação | Monte Carlo, otimização | alto |

A ordem vai de projetos com dados que **já existem** para os que dependem de dados **novos** (itens de nota), e alterna ML clássico com AI engineering para você praticar os dois lados.
