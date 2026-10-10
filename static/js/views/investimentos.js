import { api } from "../api.js";
import { PALETTE, renderChart } from "../components/charts.js";
import { categorySelect, fields, options, readForm } from "../components/form.js";
import { confirmDialog, openModal, toast } from "../components/modal.js";
import { addMonths, currentMonth, fmtDate, fmtMonth, html, money, pct, signClass, todayISO } from "../format.js";
import { icon } from "../icons.js";
import { setQuery } from "../router.js";
import { activeCategories, store } from "../state.js";
import { editDelete, empty, kpi, monthNav, pageHead, progress } from "../ui.js";

const KIND_STYLE = {
  aporte: { badge: "badge-ok", icon: "arrow-down-left", sign: "+" },
  resgate: { badge: "badge-warn", icon: "arrow-up-right", sign: "−" },
  rendimento: { badge: "badge-info", icon: "trending-up", sign: "" },
};
const typeLabel = (v) => store.meta.investment_types.find((t) => t.value === v)?.label || v;
const kindLabel = (v) => store.meta.movement_kinds.find((t) => t.value === v)?.label || v;

/** Grupo padrão sugerido pelo tipo (reserva -> Reserva de emergência; demais -> Investimentos). */
const defaultCategory = (type) => {
  const cats = activeCategories("investimento");
  const name = type === "reserva" ? "Reserva de emergência" : "Investimentos";
  return (cats.find((c) => c.name === name) || cats[0])?.id;
};

function investmentForm(item, onSaved) {
  const values = { type: "renda_fixa", color: "#10b981", active: true, ...item };
  values.category ??= defaultCategory(values.type);
  openModal({
    title: item ? "Editar investimento" : "Novo investimento",
    content: html`<div class="space-y-4">
      ${fields(
        [
          { name: "name", label: "Nome", required: true, full: true, placeholder: "Reserva Nubank, Tesouro IPCA 2035…" },
          { name: "type", label: "Tipo", type: "select", options: store.meta.investment_types, required: true },
          { name: "institution", label: "Instituição", placeholder: "Banco, corretora…" },
          { name: "goal", label: "Meta (opcional)", type: "money", hint: "Ex.: 6 meses de gastos essenciais" },
          { name: "monthly_target", label: "Aporte mensal planejado", type: "money" },
          { name: "color", label: "Cor", type: "color" },
          { name: "active", label: "Ativo", type: "checkbox" },
        ],
        values
      )}
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">${categorySelect("category", activeCategories("investimento"), values.category, { label: "Grupo (orçamento)" })}</div>
      ${fields([{ name: "notes", label: "Observações", type: "textarea" }], values)}
    </div>`,
    onOpen: (form) => {
      let touched = Boolean(item);
      form.category.addEventListener("change", (e) => e.isTrusted && (touched = true));
      form.type.addEventListener("change", () => {
        if (touched) return;
        form.category.value = defaultCategory(form.type.value) ?? "";
        form.category.dispatchEvent(new Event("change", { bubbles: true }));
      });
    },
    onSubmit: async (form) => {
      const data = readForm(form);
      data.notes = data.notes || "";
      await api.save("investments", { ...data, id: item?.id });
      toast("Investimento salvo");
      onSaved();
    },
  });
}

function movementForm(movement, defaults, investments, onSaved) {
  const values = { kind: "aporte", date: todayISO(), ...defaults, ...movement };
  openModal({
    title: movement ? "Editar movimentação" : `Registrar ${kindLabel(values.kind).toLowerCase()}`,
    content: html`${fields(
      [
        { name: "investment", label: "Investimento", type: "select", required: true, options: options(investments.filter((i) => i.active || i.id === values.investment)), full: true },
        { name: "kind", label: "Tipo", type: "seg", options: store.meta.movement_kinds, required: true },
        { name: "amount", label: "Valor", type: "money", signed: true, required: true },
        { name: "date", label: "Data", type: "date", required: true },
        { name: "notes", label: "Observação", full: true },
      ],
      values
    )}<p class="mt-4 hint">Aportes entram no orçamento do mês (bloco do grupo do investimento). Resgates e rendimentos só alteram o saldo. Rendimento pode ser negativo.</p>`,
    onSubmit: async (form) => {
      const data = readForm(form);
      data.notes = data.notes || "";
      await api.save("investment-movements", { ...data, id: movement?.id });
      toast("Movimentação salva");
      onSaved();
    },
  });
}

function balanceForm(investment, onSaved) {
  openModal({
    title: `Atualizar saldo · ${investment.name}`,
    content: html`${fields(
      [
        { name: "value", label: "Saldo atual", type: "money", required: true },
        { name: "date", label: "Data", type: "date", required: true },
      ],
      { value: investment.stats.balance, date: todayISO() }
    )}<p class="mt-4 hint">Informe o saldo que aparece no banco/corretora. A diferença para o saldo calculado (${money(investment.stats.balance)}) é registrada como rendimento.</p>`,
    onSubmit: async (form) => {
      await api.post(`investments/${investment.id}/balance/`, readForm(form));
      toast("Saldo atualizado");
      onSaved();
    },
  });
}

export async function render(container, { query }) {
  const el = document.createElement("div");
  container.replaceChildren(el);
  const month = query.month || currentMonth();
  setQuery(month === currentMonth() ? {} : { month });
  const [investments, summary, movements] = await Promise.all([
    api.get("investments/", { month }),
    api.get("investments/summary/", { month }),
    api.get("investment-movements/", { month, page_size: 500 }),
  ]);
  const reload = (m = month) => render(container, { query: { month: m } });
  const plannedPct = summary.month_planned ? (summary.month_deposits / summary.month_planned) * 100 : null;

  el.innerHTML = html`
    ${pageHead("Investimentos", html`${monthNav(month)}
      <button class="btn" data-new-movement ${investments.length ? "" : "disabled"}>${icon("arrow-down-left")}Aporte</button>
      <button class="btn btn-primary" data-new>${icon("plus")}Investimento</button>`)}
    <div class="stack">
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        ${kpi("Patrimônio", money(summary.balance), { iconName: "piggy-bank", sub: `investido ${money(summary.invested)}` })}
        <div class="card">
          <div class="kpi-label">${icon("arrow-down-left", "size-3.5")}Aportado em ${fmtMonth(`${month}-01`)}</div>
          <div class="kpi-value">${money(summary.month_deposits)}</div>
          ${summary.month_planned ? html`<div class="mt-2">${progress(plannedPct)}</div><div class="mt-1 text-xs muted">planejado ${money(summary.month_planned)}</div>` : ""}
        </div>
        ${kpi("Rendimento no mês", money(summary.month_yield), { iconName: "trending-up", cls: signClass(summary.month_yield), sub: `total ${money(summary.yield_total)}` })}
        ${kpi("Resgates no mês", money(summary.month_withdrawals), { iconName: "arrow-up-right" })}
      </div>

      ${investments.length
        ? html`<div class="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div class="grid gap-4 sm:grid-cols-2">${investments.map((i) => {
              const st = i.stats;
              return html`<div class="card ${i.active ? "" : "opacity-60"}" data-id="${i.id}" style="border-top:4px solid ${i.color}">
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <div class="truncate font-semibold">${i.name}</div>
                    <div class="text-xs muted">${typeLabel(i.type)}${i.institution ? ` · ${i.institution}` : ""}${i.active ? "" : " · inativo"}</div>
                  </div>
                  <div class="-mr-2 -mt-1 flex">${editDelete()}</div>
                </div>
                <div class="num mt-3 text-2xl font-bold">${money(st.balance)}</div>
                <div class="mt-1 flex flex-wrap gap-x-3 text-xs muted">
                  <span>investido ${money(st.invested)}</span>
                  <span class="${signClass(st.yield_total)}">rend. ${money(st.yield_total)}${st.yield_pct !== null ? ` (${pct(st.yield_pct)})` : ""}</span>
                </div>
                ${i.goal ? html`<div class="mt-3">${progress(st.goal_pct)}<div class="mt-1 text-xs muted">${pct(st.goal_pct)} da meta de ${money(i.goal)}</div></div>` : ""}
                ${i.monthly_target ? html`<div class="mt-2 text-xs muted">Aporte do mês ${money(st.month_deposits)} de ${money(i.monthly_target)} planejado</div>` : ""}
                <div class="mt-4 flex flex-wrap gap-2">
                  <button class="btn btn-sm btn-primary" data-move="aporte">${icon("arrow-down-left", "size-3.5")}Aportar</button>
                  <button class="btn btn-sm" data-move="resgate">${icon("arrow-up-right", "size-3.5")}Resgatar</button>
                  <button class="btn btn-sm" data-balance>${icon("refresh-cw", "size-3.5")}Atualizar saldo</button>
                </div>
              </div>`;
            })}</div>
            <div class="card"><h2 class="card-title">Alocação</h2>
              ${summary.balance > 0 ? html`<div class="chart-box"><canvas id="ch-allocation"></canvas></div>` : empty("Sem saldo ainda", "chart-pie")}
            </div>
          </div>`
        : html`<div class="card">${empty("Cadastre sua reserva de emergência, Tesouro, CDB, ações… e registre os aportes por aqui.", "piggy-bank")}</div>`}

      <div class="card">
        <h2 class="card-title">Movimentações de ${fmtMonth(`${month}-01`)}</h2>
        ${movements.results.length ? "" : empty("Nenhuma movimentação neste mês.", "inbox")}
        <div class="list">${movements.results.map((m) => {
          const st = KIND_STYLE[m.kind];
          return html`<div class="list-row" data-movement="${m.id}">
            <span class="grid size-9 shrink-0 place-items-center rounded-lg text-white" style="background:${m.investment_color}">${icon(st.icon)}</span>
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2"><span class="truncate font-medium">${m.investment_name}</span><span class="badge ${st.badge}">${kindLabel(m.kind)}</span></div>
              <div class="text-xs muted">${fmtDate(m.date)}${m.notes ? ` · ${m.notes}` : ""}</div>
            </div>
            <span class="num font-semibold ${m.kind === "resgate" ? "" : signClass(m.amount)}">${m.kind === "rendimento" ? (m.amount < 0 ? "−" : "+") : st.sign}${money(Math.abs(m.amount))}</span>
            <div class="-mr-2 flex">${editDelete()}</div>
          </div>`;
        })}</div>
      </div>
    </div>`;

  const withBalance = investments.filter((i) => i.stats.balance > 0);
  if (withBalance.length)
    renderChart(document.getElementById("ch-allocation"), {
      type: "doughnut",
      data: {
        labels: withBalance.map((i) => i.name),
        datasets: [{ data: withBalance.map((i) => i.stats.balance), backgroundColor: withBalance.map((i, n) => i.color || PALETTE[n]), borderWidth: 0 }],
      },
      options: {
        cutout: "65%",
        plugins: {
          legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 8 } },
          tooltip: { callbacks: { label: (c) => `${c.label}: ${money(c.raw)}` } },
        },
      },
    });

  el.addEventListener("click", async (e) => {
    const t = e.target;
    const step = Number(t.closest("[data-step]")?.dataset.step);
    if (step) return reload(addMonths(month, step));
    if (t.closest("[data-new]")) return investmentForm(null, reload);
    if (t.closest("[data-new-movement]")) return movementForm(null, { investment: investments.find((i) => i.active)?.id }, investments, reload);

    const card = t.closest("[data-id]");
    if (card) {
      const inv = investments.find((i) => String(i.id) === card.dataset.id);
      const move = t.closest("[data-move]");
      if (move) return movementForm(null, { investment: inv.id, kind: move.dataset.move }, investments, reload);
      if (t.closest("[data-balance]")) return balanceForm(inv, reload);
      if (t.closest("[data-edit]")) return investmentForm(inv, reload);
      if (t.closest("[data-del]")) {
        const ok = await confirmDialog(`Excluir "${inv.name}" e todas as suas movimentações? Os aportes saem do orçamento.`, { okLabel: "Excluir" });
        if (!ok) return;
        await api.del(`investments/${inv.id}/`);
        toast("Investimento excluído");
        return reload();
      }
    }
    const row = t.closest("[data-movement]");
    if (row) {
      const mv = movements.results.find((m) => String(m.id) === row.dataset.movement);
      if (t.closest("[data-edit]")) return movementForm(mv, {}, investments, reload);
      if (t.closest("[data-del]") && (await confirmDialog("Excluir esta movimentação?", { okLabel: "Excluir" }))) {
        await api.del(`investment-movements/${mv.id}/`);
        toast("Movimentação excluída");
        reload();
      }
    }
  });
}
