import { api } from "../api.js";
import { PALETTE, moneyTick, renderChart } from "../components/charts.js";
import { fields, readForm } from "../components/form.js";
import { skeletonRows } from "../components/loading.js";
import { openModal, toast } from "../components/modal.js";
import { addMonths, currentMonth, fmtDate, fmtMonth, fmtMonthLong, html, money, pct, signClass } from "../format.js";
import { icon } from "../icons.js";
import { setQuery } from "../router.js";
import { empty, kpi, monthNav, pageHead, progress } from "../ui.js";

const STATUS = { paga: "badge-ok", fechada: "badge-warn", aberta: "badge-info" };
const COMMITMENT = {
  ok: { bar: "", badge: "badge-ok", label: "dentro do teto" },
  warning: { bar: "warn", badge: "badge-warn", label: "perto do teto" },
  over: { bar: "danger", badge: "badge-danger", label: "acima do teto" },
};

function commitmentCard(c, month) {
  const style = COMMITMENT[c.status];
  const fill = Number(c.ceiling_amount) ? Math.min((c.committed / c.ceiling_amount) * 100, 100) : c.committed ? 100 : 0;
  return html`<div class="card">
    <h2 class="card-title">Parcelados no mês
      <span class="flex items-center gap-2"><span class="badge ${style.badge}">${style.label}</span>
      <a href="#/config" class="text-xs font-medium text-indigo-600 dark:text-indigo-400">ajustar teto</a></span></h2>
    <div class="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
      <div><div class="num text-2xl font-bold">${money(c.committed)}</div>
        <div class="text-xs muted">${pct(Number(c.pct))} da entrada esperada em parcelas</div></div>
      <div class="sm:text-right"><div class="num text-sm font-semibold">teto ${pct(Number(c.ceiling_pct))} · ${money(c.ceiling_amount)}</div>
        ${c.status === "over"
          ? html`<div class="text-xs neg">${money(c.excess)} acima do teto</div>`
          : html`<div class="text-xs muted">${money(c.ceiling_amount - c.committed)} de folga</div>`}</div>
    </div>
    <div class="progress ${style.bar} mt-3"><div style="width:${fill}%"></div></div>
    <a href="#/lancamentos?month=${month}" class="mt-2 inline-block text-xs muted hover:text-indigo-600 dark:hover:text-indigo-400">Compras parceladas (2x ou mais), em qualquer forma de pagamento</a>
  </div>`;
}

const BLOCK_COLS = "md:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))_minmax(0,1.2fr)]";

export async function render(el, { query }) {
  let month = query.month || currentMonth();
  el.innerHTML = html`${pageHead("Dashboard", monthNav(month))}<div data-body><div class="card">${skeletonRows()}</div></div>`;

  el.querySelector("[data-monthnav]").addEventListener("click", (e) => {
    const step = Number(e.target.closest("[data-step]")?.dataset.step);
    if (!step) return;
    month = addMonths(month, step);
    load();
  });

  async function load() {
    setQuery(month === currentMonth() ? {} : { month });
    el.querySelector("[data-month-label]").textContent = fmtMonthLong(`${month}-01`);
    const body = el.querySelector("[data-body]");
    body.classList.add("is-loading");
    try {
      const [summary, projection] = await Promise.all([
        api.get("dashboard/", { month }),
        api.get("projection/", { months: 12, start: month }),
      ]);
      draw(body, summary, projection, month, load);
    } finally {
      body.classList.remove("is-loading");
    }
  }

  await load();
}

function blockDetails(b, categories, month) {
  const share = (v) => (b.used ? Math.round((v / b.used) * 100) : 0);
  return html`<div class="mb-3 rounded-xl bg-slate-50 p-4 dark:bg-slate-800/50">
    <div class="space-y-4">${b.natures.map((n) => {
      const cats = categories.filter((c) => c.nature_id === n.id);
      return html`<div>
        <div class="flex items-center justify-between gap-3 text-sm font-medium">
          <span>${n.name}</span>
          <span class="flex items-center gap-2"><span class="num">${money(n.total)}</span><span class="w-10 text-right text-xs font-normal muted">${share(n.total)}%</span></span>
        </div>
        ${cats.length
          ? html`<div class="mt-1.5 space-y-1 border-l-2 border-slate-200 pl-3 dark:border-slate-700">${cats.map(
              (c) => html`<a href="#/lancamentos?month=${month}&category=${c.id}" class="flex justify-between gap-3 rounded text-sm muted hover:text-indigo-600 dark:hover:text-indigo-400">
                <span class="truncate">${c.name}</span><span class="num">${money(c.total)}</span></a>`
            )}</div>`
          : html`<div class="mt-1 border-l-2 border-slate-200 pl-3 text-xs muted dark:border-slate-700">Sem lançamentos</div>`}
      </div>`;
    })}</div>
    <a href="#/lancamentos?month=${month}&block=${b.id}" class="mt-4 inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
      Ver lançamentos de ${b.name}${icon("arrow-up-right", "size-3.5")}</a>
  </div>`;
}

function blocksTable(blocks, categories, month) {
  const total = blocks.reduce(
    (acc, b) => ({ used: acc.used + b.used, budget: acc.budget + b.budget, remaining: acc.remaining + b.remaining }),
    { used: 0, budget: 0, remaining: 0 }
  );
  const totalPct = total.budget ? (total.used / total.budget) * 100 : null;
  const cells = (b, isTotal = false) => html`
      <div class="flex items-center gap-2 font-medium">
        ${isTotal ? "" : html`<span class="dot" style="background:${b.color}"></span>`}${b.name}
        ${isTotal ? "" : icon("chevron-down", "size-4 text-slate-400 transition-transform group-aria-expanded:rotate-180")}
      </div>
      <div class="num text-right md:order-4 ${signClass(b.remaining)}"><span class="mr-1 text-xs font-normal muted md:hidden">resta</span>${money(b.remaining)}</div>
      <div class="num text-sm muted md:order-2 md:text-right md:text-base md:text-inherit"><span class="md:hidden">Utilizado </span>${money(b.used)}</div>
      <div class="num text-right text-sm muted md:order-3 md:text-base md:text-inherit"><span class="md:hidden">Orçamento </span>${money(b.budget)}</div>
      <div class="col-span-2 flex items-center gap-2 md:order-5 md:col-span-1">${progress(b.pct)}<span class="num w-12 text-right text-xs muted">${pct(b.pct === null ? null : Math.round(b.pct))}</span></div>`;
  const rowCls = `grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 py-3 text-left ${BLOCK_COLS}`;
  return html`
    <div class="list-head ${BLOCK_COLS} gap-x-4"><span>Bloco</span><span class="text-right">Utilizado</span><span class="text-right">Orçamento</span><span class="text-right">Remanescente</span><span>Uso</span></div>
    <div class="list">${blocks.map(
      (b) => html`<div>
        <button type="button" class="group ${rowCls} cursor-pointer rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/40"
          aria-expanded="false" aria-controls="block-detail-${b.id}" data-block-toggle title="Ver detalhes">${cells(b)}</button>
        <div id="block-detail-${b.id}" hidden>${blockDetails(b, categories, month)}</div>
      </div>`
    )}</div>
    <div class="${rowCls} border-t-2 border-slate-200 font-semibold dark:border-slate-700">${cells({ name: "Total", ...total, pct: totalPct }, true)}</div>`;
}

function draw(body, s, projection, month, reload) {
  body.innerHTML = html`
    <div class="stack">
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div class="card">
          <div class="kpi-label">${icon("wallet", "size-3.5")}Entrada esperada
            <button class="ml-auto cursor-pointer text-indigo-600 hover:underline dark:text-indigo-400" data-plan title="Editar entrada do mês">${icon("pencil", "size-3.5")}</button></div>
          <div class="kpi-value">${money(s.expected_income)}</div>
        </div>
        ${kpi("Recebido", money(s.received), { iconName: "trending-up" })}
        ${kpi("Gasto no mês", money(s.spent), { iconName: "trending-down", sub: `pendente ${money(s.pending)}` })}
        ${kpi("Saldo previsto", money(s.balance_expected), { iconName: "piggy-bank", cls: signClass(s.balance_expected), sub: `sobre recebido ${money(s.balance_received)}` })}
      </div>

      ${commitmentCard(s.installments_commitment, month)}

      <div class="card"><h2 class="card-title">Orçamento por bloco <span class="text-xs font-normal muted">clique em um bloco para ver o detalhe</span></h2>${blocksTable(s.blocks, s.by_category, month)}</div>

      <div class="grid gap-4 lg:grid-cols-2">
        <div class="card"><h2 class="card-title">Por natureza</h2>${s.by_nature.length ? html`<div class="chart-box"><canvas id="ch-nature"></canvas></div>` : empty("Sem gastos no mês", "chart-pie")}</div>
        <div class="card"><h2 class="card-title">Por grupo</h2>${
          s.by_category.length
            ? html`<div class="chart-box" style="height:${Math.max(220, s.by_category.length * 30)}px"><canvas id="ch-category"></canvas></div>`
            : empty("Sem gastos no mês", "chart-bar")
        }</div>
      </div>

      <div class="card">
        <h2 class="card-title">Projeção 12 meses <span class="text-xs font-normal muted">parcelas + recorrentes</span></h2>
        <div class="chart-box !h-72"><canvas id="ch-projection"></canvas></div>
        <div class="mt-4 list-head grid-cols-4 gap-x-4"><span>Mês</span><span class="text-right">Esperado</span><span class="text-right">Comprometido</span><span class="text-right">Livre</span></div>
        <div class="list">${projection.months.map(
          (m) => html`<div class="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 py-2.5 text-sm md:grid-cols-4">
            <span class="font-medium">${fmtMonth(m.month)}</span>
            <span class="num text-right font-semibold md:order-4 ${signClass(m.free)}">${money(m.free)}</span>
            <span class="num text-xs muted md:order-2 md:text-right md:text-sm">${money(m.expected_income)}<span class="md:hidden"> esperado</span></span>
            <span class="num text-right text-xs muted md:order-3 md:text-sm">${money(m.committed)} · ${pct(m.committed_pct)}</span>
          </div>`
        )}</div>
      </div>

      <div class="grid gap-4 lg:grid-cols-2">
        <div class="card">
          <h2 class="card-title">Faturas do mês <a href="#/cartoes" class="text-xs font-medium text-indigo-600 dark:text-indigo-400">ver cartões</a></h2>
          ${s.invoices.length
            ? html`<div class="list">${s.invoices.map(
                (i) => html`<a href="#/cartoes/${i.card_id}?month=${month}" class="list-row hover:opacity-80">
                  <span class="grid size-9 place-items-center rounded-lg text-white" style="background:${i.color}">${icon("credit-card")}</span>
                  <div class="min-w-0 flex-1"><div class="font-medium">${i.card}</div><div class="text-xs muted">vence ${fmtDate(i.due_date)}</div></div>
                  <div class="text-right"><div class="num font-semibold">${money(i.total)}</div><span class="badge ${STATUS[i.status]}">${i.status}</span></div>
                </a>`
              )}</div>`
            : empty("Nenhuma fatura neste mês", "credit-card")}
          ${s.by_payment_method.length
            ? html`<h3 class="mt-5 mb-2 text-sm font-semibold">Por forma de pagamento</h3>
              <div class="list text-sm">${s.by_payment_method.map(
                (m) => html`<div class="flex justify-between py-2"><span>${m.name}</span><span class="num font-medium">${money(m.total)}</span></div>`
              )}</div>`
            : ""}
        </div>

        <div class="card">
          <h2 class="card-title">Investimentos <a href="#/investimentos" class="text-xs font-medium text-indigo-600 dark:text-indigo-400">gerenciar</a></h2>
          ${s.investments.count || Number(s.investments.balance)
            ? html`<div class="flex items-center gap-3">
                <span class="grid size-11 place-items-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">${icon("piggy-bank", "size-5")}</span>
                <div><div class="num text-xl font-bold">${money(s.investments.balance)}</div><div class="text-xs muted">patrimônio · rendimento total ${money(s.investments.yield_total)}</div></div>
              </div>
              <div class="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                <div class="rounded-xl bg-slate-50 p-2 dark:bg-slate-800/60"><div class="muted">Aportado</div><div class="num text-sm font-semibold">${money(s.investments.month_deposits)}</div></div>
                <div class="rounded-xl bg-slate-50 p-2 dark:bg-slate-800/60"><div class="muted">Rendimento</div><div class="num text-sm font-semibold ${signClass(s.investments.month_yield)}">${money(s.investments.month_yield)}</div></div>
                <div class="rounded-xl bg-slate-50 p-2 dark:bg-slate-800/60"><div class="muted">Resgates</div><div class="num text-sm font-semibold">${money(s.investments.month_withdrawals)}</div></div>
              </div>
              ${s.investments.month_planned
                ? html`<div class="mt-4">${progress((s.investments.month_deposits / s.investments.month_planned) * 100)}
                    <div class="mt-1 text-xs muted">${money(s.investments.month_deposits)} de ${money(s.investments.month_planned)} planejados no mês</div></div>`
                : ""}
              <div class="mt-4 list">${s.investments.items.filter((i) => i.active).slice(0, 4).map(
                (i) => html`<div class="flex items-center justify-between gap-2 py-2 text-sm"><span class="flex min-w-0 items-center gap-2"><span class="dot" style="background:${i.color}"></span><span class="truncate">${i.name}</span></span><span class="num font-medium">${money(i.balance)}</span></div>`
              )}</div>`
            : empty("Nenhum investimento cadastrado", "piggy-bank")}
        </div>

        <div class="card">
          <h2 class="card-title">Assinaturas <a href="#/assinaturas" class="text-xs font-medium text-indigo-600 dark:text-indigo-400">gerenciar</a></h2>
          <div class="flex items-center gap-3">
            <span class="grid size-11 place-items-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300">${icon("monitor-play", "size-5")}</span>
            <div><div class="num text-xl font-bold">${money(s.subscriptions.monthly)}<span class="text-sm font-normal muted">/mês</span></div>
            <div class="text-xs muted">${s.subscriptions.count} ativa(s) · ${money(s.subscriptions.monthly * 12)}/ano</div></div>
          </div>
        </div>

        <div class="card">
          <h2 class="card-title">Dívidas <a href="#/dividas" class="text-xs font-medium text-indigo-600 dark:text-indigo-400">gerenciar</a></h2>
          ${s.debts.length
            ? html`<div class="mb-3 text-sm">Saldo devedor <b class="num neg">${money(s.debts.reduce((t, d) => t + d.remaining, 0))}</b></div>
              <div class="list">${s.debts.map(
                (d) => html`<div class="py-3 first:pt-0">
                  <div class="flex justify-between gap-2"><span class="font-medium">${d.description}</span><span class="num font-semibold">${money(d.remaining)}</span></div>
                  <div class="my-1.5">${progress(d.total ? (d.paid / d.total) * 100 : 0)}</div>
                  <div class="text-xs muted">${d.paid_count}/${d.installments_count} pagas${d.next_due ? ` · próxima ${fmtDate(d.next_due)} (${money(d.next_amount)})` : ""}</div>
                </div>`
              )}</div>`
            : empty("Nenhuma dívida em aberto", "circle-check")}
        </div>
      </div>
    </div>`;

  body.querySelectorAll("[data-block-toggle]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const open = btn.getAttribute("aria-expanded") !== "true";
      btn.setAttribute("aria-expanded", String(open));
      document.getElementById(btn.getAttribute("aria-controls")).hidden = !open;
    })
  );

  body.querySelector("[data-plan]").addEventListener("click", () =>
    openModal({
      title: `Entrada esperada · ${fmtMonthLong(`${month}-01`)}`,
      content: html`${fields([{ name: "expected_income", label: "Valor esperado", type: "money", required: true, full: true }], {
        expected_income: s.expected_income,
      })}<p class="mt-3 hint">Sobrescreve a soma das fontes de receita apenas neste mês.</p>`,
      onSubmit: async (form) => {
        await api.post("month-plans/", { competence: `${month}-01`, ...readForm(form) });
        toast("Entrada atualizada");
        reload();
      },
    })
  );

  if (s.by_nature.length)
    renderChart(document.getElementById("ch-nature"), {
      type: "doughnut",
      data: {
        labels: s.by_nature.map((n) => n.name),
        datasets: [{ data: s.by_nature.map((n) => n.total), backgroundColor: PALETTE, borderWidth: 0 }],
      },
      options: {
        cutout: "65%",
        plugins: {
          legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 8 } },
          tooltip: { callbacks: { label: (c) => `${c.label}: ${money(c.raw)}` } },
        },
      },
    });

  if (s.by_category.length)
    renderChart(document.getElementById("ch-category"), {
      type: "bar",
      data: {
        labels: s.by_category.map((c) => c.name),
        datasets: [{ data: s.by_category.map((c) => c.total), backgroundColor: PALETTE[0], borderRadius: 6 }],
      },
      options: {
        indexAxis: "y",
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => money(c.raw) } } },
        scales: { x: { ticks: { callback: moneyTick, maxTicksLimit: 5 } }, y: { grid: { display: false } } },
      },
    });

  const blocks = projection.months[0]?.blocks || [];
  renderChart(document.getElementById("ch-projection"), {
    type: "bar",
    data: {
      labels: projection.months.map((m) => fmtMonth(m.month)),
      datasets: [
        {
          type: "line",
          label: "Entrada esperada",
          data: projection.months.map((m) => m.expected_income),
          borderColor: "#94a3b8",
          borderDash: [6, 4],
          pointRadius: 0,
        },
        ...blocks.map((b, i) => ({
          label: b.name,
          data: projection.months.map((m) => m.blocks[i].used),
          backgroundColor: b.color,
          stack: "committed",
          borderRadius: 4,
        })),
      ],
    },
    options: {
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 8 } },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${money(c.raw)}` } },
      },
      scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, ticks: { callback: moneyTick, maxTicksLimit: 6 } } },
    },
  });
}
