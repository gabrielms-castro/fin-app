import { api } from "../api.js";
import { fields, options, readForm } from "../components/form.js";
import { confirmDialog, openModal, toast } from "../components/modal.js";
import { addMonths, currentMonth, fmtDate, fmtMonth, html, money, todayISO } from "../format.js";
import { icon } from "../icons.js";
import { setQuery } from "../router.js";
import { refresh, store } from "../state.js";
import { editDelete, empty, kpi, monthNav, pageHead } from "../ui.js";

function sourceForm(item, onSaved) {
  openModal({
    title: item ? "Editar fonte de receita" : "Nova fonte de receita",
    content: html`${fields(
      [
        { name: "name", label: "Nome", required: true, full: true, placeholder: "Salário, freela fixo…" },
        { name: "amount", label: "Valor esperado/mês", type: "money", required: true },
        { name: "day", label: "Dia de recebimento", type: "number", min: 1, max: 31, required: true },
        { name: "start_month", label: "Início", type: "month", required: true },
        { name: "end_month", label: "Fim (opcional)", type: "month" },
        { name: "active", label: "Ativa", type: "checkbox" },
      ],
      { day: 5, active: true, start_month: currentMonth(), ...item }
    )}<p class="mt-4 hint">A soma das fontes ativas forma a "Entrada (expectativa)" de cada mês.</p>`,
    onSubmit: async (form) => {
      await api.save("income-sources", { ...readForm(form), id: item?.id });
      await refresh("incomeSources");
      toast("Fonte salva");
      onSaved();
    },
  });
}

function incomeForm(item, defaults, onSaved) {
  openModal({
    title: item ? "Editar recebimento" : "Registrar recebimento",
    content: fields(
      [
        { name: "description", label: "Descrição", required: true, full: true },
        { name: "amount", label: "Valor", type: "money", required: true },
        { name: "date", label: "Data", type: "date", required: true },
        { name: "source", label: "Fonte", type: "select", empty: "Avulso", options: options(store.incomeSources), full: true },
      ],
      { date: todayISO(), ...defaults, ...item }
    ),
    onSubmit: async (form) => {
      await api.save("incomes", { ...readForm(form), id: item?.id });
      toast("Recebimento salvo");
      onSaved();
    },
  });
}

export async function render(container, { query }) {
  const el = document.createElement("div");
  container.replaceChildren(el);
  const month = query.month || currentMonth();
  setQuery(month === currentMonth() ? {} : { month });
  await refresh("incomeSources");
  const [incomes, summary] = await Promise.all([
    api.get("incomes/", { month, page_size: 500 }),
    api.get("dashboard/", { month }),
  ]);
  const reload = (m = month) => render(container, { query: { month: m } });
  const sources = store.incomeSources;

  el.innerHTML = html`
    ${pageHead("Receitas", html`${monthNav(month)}<button class="btn btn-primary" data-new-income>${icon("plus")}Recebimento</button>`)}
    <div class="stack">
      <div class="grid grid-cols-2 gap-3">
        ${kpi("Esperado", money(summary.expected_income), { iconName: "wallet" })}
        ${kpi("Recebido", money(summary.received), { iconName: "trending-up", cls: summary.received >= summary.expected_income && summary.received > 0 ? "pos" : "" })}
      </div>
      <div class="grid items-start gap-4 lg:grid-cols-2">
        <div class="card">
          <h2 class="card-title">Recebimentos de ${fmtMonth(`${month}-01`)}</h2>
          ${incomes.results.length ? "" : empty("Nada recebido neste mês.", "inbox")}
          <div class="list">${incomes.results.map(
            (i) => html`<div class="list-row" data-income="${i.id}">
              <div class="min-w-0 flex-1"><div class="truncate font-medium">${i.description}</div><div class="text-xs muted">${fmtDate(i.date)}${i.source_name ? ` · ${i.source_name}` : ""}</div></div>
              <span class="num font-semibold pos">${money(i.amount)}</span>
              <div class="-mr-2 flex">${editDelete()}</div>
            </div>`
          )}</div>
        </div>
        <div class="card">
          <h2 class="card-title">Fontes de receita <button class="btn btn-sm" data-new-source>${icon("plus", "size-3.5")}Fonte</button></h2>
          ${sources.length ? "" : empty("Cadastre seu salário para definir a entrada esperada.", "wallet")}
          <div class="list">${sources.map(
            (s) => html`<div class="list-row" data-source="${s.id}">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2 font-medium">${s.name}${s.active ? "" : html`<span class="badge">inativa</span>`}</div>
                <div class="text-xs muted">dia ${s.day} · desde ${fmtMonth(s.start_month)}${s.end_month ? ` até ${fmtMonth(s.end_month)}` : ""}</div>
              </div>
              <span class="num font-semibold">${money(s.amount)}</span>
              <button class="btn btn-sm" data-receive>${icon("check", "size-3.5")}Recebi</button>
              <div class="-mr-2 flex">${editDelete()}</div>
            </div>`
          )}</div>
        </div>
      </div>
    </div>`;

  el.addEventListener("click", async (e) => {
    const target = e.target;
    const step = Number(target.closest("[data-step]")?.dataset.step);
    if (step) return reload(addMonths(month, step));
    if (target.closest("[data-new-income]")) return incomeForm(null, {}, reload);
    if (target.closest("[data-new-source]")) return sourceForm(null, reload);

    const incomeRow = target.closest("[data-income]");
    if (incomeRow) {
      const item = incomes.results.find((i) => String(i.id) === incomeRow.dataset.income);
      if (target.closest("[data-edit]")) incomeForm(item, {}, reload);
      if (target.closest("[data-del]") && (await confirmDialog("Excluir este recebimento?", { okLabel: "Excluir" }))) {
        await api.del(`incomes/${item.id}/`);
        reload();
      }
      return;
    }
    const sourceRow = target.closest("[data-source]");
    if (sourceRow) {
      const source = sources.find((s) => String(s.id) === sourceRow.dataset.source);
      if (target.closest("[data-receive]")) {
        incomeForm(null, { description: source.name, amount: source.amount, source: source.id }, reload);
      } else if (target.closest("[data-edit]")) {
        sourceForm(source, reload);
      } else if (target.closest("[data-del]") && (await confirmDialog(`Excluir a fonte "${source.name}"?`, { okLabel: "Excluir" }))) {
        await api.del(`income-sources/${source.id}/`);
        await refresh("incomeSources");
        reload();
      }
    }
  });
}
