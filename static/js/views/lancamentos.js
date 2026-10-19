import { api } from "../api.js";
import { fields, options, readForm } from "../components/form.js";
import { setButtonLoading, skeletonRows } from "../components/loading.js";
import { confirmDialog, toast } from "../components/modal.js";
import { addMonths, currentMonth, fmtDate, fmtMonth, fmtMonthLong, html, money } from "../format.js";
import { icon } from "../icons.js";
import { setQuery } from "../router.js";
import { kindLabel, methodLabel, store } from "../state.js";
import { editDelete, empty, iconButton, monthNav, pageHead, statusBadge } from "../ui.js";
import { openExpenseForm } from "./expense-form.js";

const FILTER_KEYS = ["search", "month", "month_from", "month_to", "payment_method", "card", "block", "nature", "category", "kind", "paid", "parcelado"];
const OWN_TAB = {
  divida: { href: "#/dividas", title: "Gerenciar em Dívidas" },
  investimento: { href: "#/investimentos", title: "Gerenciar em Investimentos" },
};
const METHOD_ICONS = { credito: "credit-card", debito: "wallet", pix: "zap", dinheiro: "banknote", boleto: "file-text", transferencia: "arrow-left-right" };

export async function render(el, { query }) {
  const state = { ...query };
  if (!Object.keys(query).length) state.month = currentMonth();
  let page = 1;

  const filterSpecs = () => [
    { name: "search", label: "Buscar", placeholder: "Descrição, observação…", full: true },
    { name: "month_from", label: "De (mês)", type: "month" },
    { name: "month_to", label: "Até (mês)", type: "month" },
    { name: "payment_method", label: "Forma", type: "select", empty: "Todas", options: store.meta.payment_methods },
    { name: "card", label: "Cartão", type: "select", empty: "Todos", options: options(store.cards) },
    { name: "block", label: "Bloco", type: "select", empty: "Todos", options: options(store.blocks) },
    { name: "nature", label: "Natureza", type: "select", empty: "Todas", options: options(store.natures) },
    { name: "category", label: "Grupo", type: "select", empty: "Todos", options: options(store.categories) },
    { name: "kind", label: "Tipo", type: "select", empty: "Todos", options: store.meta.expense_kinds },
    { name: "paid", label: "Status", type: "select", empty: "Todos", options: [{ value: "true", label: "Pago" }, { value: "false", label: "Pendente" }] },
    { name: "parcelado", label: "Parcelamento", type: "select", empty: "Todos", options: [{ value: "true", label: "Só parceladas (2x+)" }, { value: "false", label: "À vista" }] },
  ];
  const activeCount = () => FILTER_KEYS.filter((k) => state[k] && k !== "month").length;

  el.innerHTML = html`
    ${pageHead(
      "Lançamentos",
      html`${monthNav(state.month || currentMonth())}
        <a class="btn" data-export>${icon("download")}<span class="hidden sm:inline">CSV</span></a>
        <button class="btn btn-primary" data-new>${icon("plus")}Novo</button>`
    )}
    <div class="stack">
      <details class="card group" ${window.innerWidth >= 1024 ? "open" : ""}>
        <summary class="flex cursor-pointer list-none items-center justify-between font-semibold">
          <span class="flex items-center gap-2">${icon("filter")}Filtros <span class="badge badge-info" data-filter-count></span></span>
          ${icon("chevron-down", "size-4 transition group-open:rotate-180")}
        </summary>
        <form data-filters class="mt-4">
          <div class="[&>div]:lg:grid-cols-4">${fields(filterSpecs(), state)}</div>
          <div class="mt-4 flex justify-end gap-2">
            <button type="button" class="btn" data-clear>Limpar</button>
            <button class="btn btn-primary">${icon("search")}Aplicar</button>
          </div>
        </form>
      </details>
      <div class="card">
        <div class="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-sm" data-totals></div>
        <div class="list" data-rows>${skeletonRows()}</div>
        <div data-empty hidden>${empty("Nenhum lançamento encontrado.", "receipt")}</div>
        <button class="btn mt-4 w-full" data-more hidden>Carregar mais</button>
      </div>
    </div>`;

  const $ = (sel) => el.querySelector(sel);
  const filterForm = $("[data-filters]");
  const params = () => Object.fromEntries(FILTER_KEYS.filter((k) => state[k]).map((k) => [k, state[k]]));

  const rowHtml = (i) => {
    const where = i.card_name ? `${methodLabel(i.payment_method)} · ${i.card_name}` : methodLabel(i.payment_method);
    const parcel = i.installments_count > 1 ? ` · ${i.number}/${i.installments_count}` : "";
    return html`<div class="list-row" data-id="${i.id}" data-expense="${i.expense}" data-paid="${i.paid ? 1 : 0}">
      <span class="hidden size-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-500 sm:grid dark:bg-slate-800 dark:text-slate-400">${icon(METHOD_ICONS[i.payment_method] || "receipt", "size-5")}</span>
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span class="truncate font-medium">${i.description}</span>
          ${i.kind !== "compra" ? html`<span class="badge badge-info">${kindLabel(i.kind)}</span>` : ""}
          ${statusBadge(i.paid)}
        </div>
        <div class="mt-0.5 text-xs muted">${fmtDate(i.date)} · ${where}${parcel} · ${fmtMonth(i.competence)}</div>
        <div class="mt-1 flex flex-wrap items-center gap-1 text-xs">
          <span class="badge">${i.category_name}</span>
          <span class="muted">${i.nature_name}</span>
          <span class="inline-flex items-center gap-1 muted">· <span class="dot !size-2" style="background:${i.block_color}"></span>${i.block_name}</span>
        </div>
      </div>
      <div class="flex flex-col items-end gap-1">
        <span class="num font-semibold">${money(i.amount)}</span>
        <div class="-mr-2 flex">
          ${i.invoice || i.kind === "investimento" ? "" : iconButton("pay", i.paid ? "undo-2" : "check", i.paid ? "Marcar pendente" : "Marcar pago")}
          ${OWN_TAB[i.kind]
            ? html`<a class="btn-icon" href="${OWN_TAB[i.kind].href}" title="${OWN_TAB[i.kind].title}" aria-label="${OWN_TAB[i.kind].title}">${icon("arrow-up-right")}</a>`
            : editDelete()}
        </div>
      </div>
    </div>`;
  };

  async function load(append = false) {
    const rows = $("[data-rows]");
    rows.classList.add("is-loading");
    const data = await api.get("installments/", { ...params(), page }).finally(() => rows.classList.remove("is-loading"));
    const markup = data.results.map(rowHtml).join("");
    if (append) rows.insertAdjacentHTML("beforeend", markup);
    else {
      rows.innerHTML = markup;
      $("[data-totals]").innerHTML = html`
        <span class="muted">${state.parcelado === "true" ? `${data.count} parcela(s) de compras parceladas` : `${data.count} parcelas`}</span>
        <span>Total <b class="num">${money(data.totals.total)}</b></span>
        <span class="pos">Pago <b class="num">${money(data.totals.paid)}</b></span>
        <span class="neg">Pendente <b class="num">${money(data.totals.pending)}</b></span>`;
    }
    $("[data-empty]").hidden = data.count > 0;
    $("[data-more]").hidden = !data.next;
  }

  function apply() {
    page = 1;
    setQuery(params());
    $("[data-month-label]").textContent = state.month ? fmtMonthLong(`${state.month}-01`) : "Período";
    $("[data-filter-count]").textContent = activeCount() || "";
    $("[data-export]").href = api.url("installments/export/", params());
    return load();
  }

  // Filtros em cascata: bloco limita naturezas, natureza limita grupos;
  // escolher um grupo preenche natureza e bloco automaticamente.
  const cascade = (changed) => {
    const f = filterForm;
    const cat = store.categories.find((c) => String(c.id) === f.category.value);
    if (changed === "category" && cat) {
      f.nature.value = cat.nature;
      f.block.value = cat.block;
    }
    if (changed === "nature" && f.nature.value) {
      const nature = store.natures.find((n) => String(n.id) === f.nature.value);
      f.block.value = nature.block;
    }
    const blockId = f.block.value;
    [...f.nature.options].forEach((o) => {
      const n = store.natures.find((x) => String(x.id) === o.value);
      o.hidden = Boolean(o.value && blockId && String(n.block) !== blockId);
    });
    if (f.nature.selectedOptions[0]?.hidden) f.nature.value = "";
    const natureId = f.nature.value;
    [...f.category.options].forEach((o) => {
      const c = store.categories.find((x) => String(x.id) === o.value);
      o.hidden = Boolean(o.value && ((natureId && String(c.nature) !== natureId) || (blockId && String(c.block) !== blockId)));
    });
    if (f.category.selectedOptions[0]?.hidden) f.category.value = "";
  };
  filterForm.addEventListener("change", (e) => {
    if (["block", "nature", "category"].includes(e.target.name)) cascade(e.target.name);
  });
  cascade();

  filterForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const data = readForm(filterForm);
    FILTER_KEYS.filter((k) => k !== "month").forEach((k) => (state[k] = data[k] ? String(data[k]).replace(/-01$/, "") : ""));
    if (state.month_from || state.month_to) state.month = "";
    apply();
  });
  $("[data-clear]").addEventListener("click", () => {
    setQuery({});
    render(el, { query: {} });
  });
  $("[data-monthnav]").addEventListener("click", (e) => {
    const step = Number(e.target.closest("[data-step]")?.dataset.step);
    if (!step) return;
    state.month = addMonths(state.month || currentMonth(), step);
    state.month_from = state.month_to = "";
    filterForm.month_from.value = filterForm.month_to.value = "";
    apply();
  });
  $("[data-more]").addEventListener("click", async (e) => {
    const button = e.currentTarget;
    page += 1;
    setButtonLoading(button, true);
    await load(true).finally(() => setButtonLoading(button, false));
  });
  $("[data-new]").addEventListener("click", async () => {
    await openExpenseForm();
    apply();
  });
  $("[data-rows]").addEventListener("click", async (e) => {
    const row = e.target.closest("[data-id]");
    if (!row) return;
    if (e.target.closest("[data-pay]")) {
      await api.post(`installments/${row.dataset.id}/pay/`, { paid: row.dataset.paid !== "1" });
      apply();
    } else if (e.target.closest("[data-edit]")) {
      const expense = await api.get(`expenses/${row.dataset.expense}/`);
      await openExpenseForm({ expense });
      apply();
    } else if (e.target.closest("[data-del]")) {
      const ok = await confirmDialog("Excluir este lançamento e todas as suas parcelas?", { okLabel: "Excluir" });
      if (!ok) return;
      await api.del(`expenses/${row.dataset.expense}/`);
      toast("Lançamento excluído");
      apply();
    }
  });

  await apply();
}
