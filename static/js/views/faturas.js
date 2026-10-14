import { api } from "../api.js";
import { skeletonRows } from "../components/loading.js";
import { toast } from "../components/modal.js";
import { addMonths, currentMonth, fmtDate, fmtMonth, html, money } from "../format.js";
import { icon } from "../icons.js";
import { setQuery } from "../router.js";
import { refresh, store } from "../state.js";
import { empty } from "../ui.js";
import { openCardForm } from "./cartoes.js";
import { openExpenseForm } from "./expense-form.js";

export async function render(el, { params, query }) {
  await refresh("cards");
  const card = store.cards.find((c) => String(c.id) === params.id);
  if (!card) {
    el.innerHTML = html`<div class="card">${empty("Cartão não encontrado.", "credit-card")}<a href="#/cartoes" class="btn mx-auto flex w-fit">Voltar</a></div>`;
    return;
  }
  let month = query.month || currentMonth();

  el.innerHTML = html`
    <div class="page-head">
      <div class="flex items-center gap-2">
        <a href="#/cartoes" class="btn-icon" aria-label="Voltar">${icon("chevron-left", "size-5")}</a>
        <span class="dot size-3" style="background:${card.color}"></span>
        <h1 class="page-title">${card.name}</h1>
      </div>
      <div class="flex gap-2">
        <button class="btn" data-edit>${icon("pencil")}Editar</button>
        <button class="btn btn-primary" data-new>${icon("plus")}Compra</button>
      </div>
    </div>
    <div class="stack">
      <div class="card"><h2 class="card-title">Faturas</h2><div class="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" data-timeline></div></div>
      <div class="card" data-invoice>${skeletonRows(3)}</div>
    </div>`;

  el.querySelector("[data-edit]").addEventListener("click", async () => {
    await openCardForm(card);
    render(el, { params, query: { month } });
  });
  el.querySelector("[data-new]").addEventListener("click", async () => {
    await openExpenseForm({ defaults: { payment_method: "credito", card: card.id } });
    load();
  });
  el.querySelector("[data-timeline]").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-month]");
    if (!btn) return;
    month = btn.dataset.month;
    load();
  });

  async function load() {
    const box = el.querySelector("[data-invoice]");
    box.classList.add("is-loading");
    try {
      await loadInvoice(box);
    } finally {
      box.classList.remove("is-loading");
    }
  }

  async function loadInvoice(box) {
    setQuery({ month });
    const invoices = await api.get("invoices/", {
      card: card.id,
      month_from: addMonths(currentMonth(), -6),
      month_to: addMonths(currentMonth(), 18),
    });
    const timeline = el.querySelector("[data-timeline]");
    timeline.innerHTML = invoices.length
      ? html`${invoices.map((inv) => {
          const active = inv.competence.startsWith(month);
          return html`<button type="button" data-month="${inv.competence.slice(0, 7)}"
            class="flex min-w-28 shrink-0 cursor-pointer flex-col items-start rounded-xl border px-3 py-2 text-left transition ${
              active
                ? "border-indigo-600 bg-indigo-600 text-white"
                : "border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
            }">
            <span class="flex items-center gap-1 text-xs ${active ? "text-white/80" : "muted"}">${fmtMonth(inv.competence)}${inv.paid ? icon("circle-check", "size-3.5") : ""}</span>
            <span class="num text-sm font-semibold">${money(inv.total)}</span>
          </button>`;
        })}`
      : html`${empty("Nenhuma fatura ainda.", "receipt")}`;
    timeline.querySelector(".bg-indigo-600")?.scrollIntoView({ inline: "center", block: "nearest" });

    const invoice = invoices.find((i) => i.competence.startsWith(month));
    if (!invoice) {
      box.innerHTML = html`${empty(`Sem fatura em ${fmtMonth(`${month}-01`)}.`, "receipt")}`;
      return;
    }
    const items = await api.get("installments/", { invoice: invoice.id, page_size: 500, ordering: "expense__date" });
    box.innerHTML = html`
      <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="flex items-center gap-2 text-base font-semibold">Fatura ${fmtMonth(invoice.competence)}
            <span class="badge ${invoice.paid ? "badge-ok" : "badge-warn"}">${invoice.paid ? `paga em ${fmtDate(invoice.paid_at)}` : "em aberto"}</span></h2>
          <div class="mt-1 text-xs muted">Fecha ${fmtDate(invoice.closing_date)} · vence ${fmtDate(invoice.due_date)}</div>
        </div>
        <div class="text-right"><div class="num text-2xl font-bold">${money(invoice.total)}</div>
          <button class="btn btn-sm mt-2 ${invoice.paid ? "" : "btn-primary"}" data-pay>${icon(invoice.paid ? "undo-2" : "check", "size-3.5")}${invoice.paid ? "Desfazer pagamento" : "Marcar como paga"}</button>
        </div>
      </div>
      <div class="list">${items.results.map(
        (i) => html`<div class="list-row">
          <div class="min-w-0 flex-1"><div class="truncate font-medium">${i.description}${i.installments_count > 1 ? html` <span class="text-xs muted">${i.number}/${i.installments_count}</span>` : ""}</div>
          <div class="text-xs muted">${fmtDate(i.date)} · ${i.category_name}</div></div>
          <span class="num font-semibold">${money(i.amount)}</span>
        </div>`
      )}</div>`;
    box.querySelector("[data-pay]").addEventListener("click", async () => {
      await api.post(`invoices/${invoice.id}/${invoice.paid ? "unpay" : "pay"}/`);
      toast(invoice.paid ? "Pagamento desfeito" : "Fatura paga");
      load();
    });
  }

  await load();
}
