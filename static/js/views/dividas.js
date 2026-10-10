import { api } from "../api.js";
import { confirmDialog, toast } from "../components/modal.js";
import { fmtDate, fmtMonth, html, money } from "../format.js";
import { icon } from "../icons.js";
import { methodLabel } from "../state.js";
import { empty, kpi, pageHead, progress, statusBadge } from "../ui.js";
import { openExpenseForm } from "./expense-form.js";

// Dívidas com todas as parcelas visíveis (sobrevive ao re-render após pagar).
const showAll = new Set();
const PREVIEW = 6;

export async function render(container, { openId } = {}) {
  const el = document.createElement("div");
  container.replaceChildren(el);
  const { results: debts } = await api.get("expenses/", { kind: "divida", with_installments: 1, page_size: 500 });
  const open = (d) => d.installments.filter((i) => !i.paid);
  const remaining = debts.reduce((s, d) => s + open(d).reduce((t, i) => t + i.amount, 0), 0);
  // Por padrão mostra só as próximas parcelas em aberto (ou as últimas, se quitada).
  const shown = (d) => {
    if (showAll.has(d.id)) return new Set(d.installments.map((i) => i.id));
    const start = d.installments.findIndex((i) => !i.paid);
    const from = start === -1 ? Math.max(0, d.installments.length - PREVIEW) : start;
    return new Set(d.installments.slice(from, from + PREVIEW).map((i) => i.id));
  };
  const next = debts.reduce((s, d) => s + (open(d)[0]?.amount || 0), 0);

  el.innerHTML = html`
    ${pageHead("Dívidas", html`<button class="btn btn-primary" data-new>${icon("plus")}Dívida</button>`)}
    <div class="stack">
      <div class="grid grid-cols-2 gap-3">
        ${kpi("Saldo devedor", money(remaining), { iconName: "landmark", cls: "neg" })}
        ${kpi("Próximas parcelas", money(next), { iconName: "calendar-clock" })}
      </div>
      ${debts.length ? "" : html`<div class="card">${empty("Nenhuma dívida cadastrada.", "landmark")}</div>`}
      ${debts.map((d) => {
        const paid = d.installments.filter((i) => i.paid);
        const rest = open(d).reduce((t, i) => t + i.amount, 0);
        return html`<details class="card group" data-id="${d.id}" ${String(openId) === String(d.id) ? "open" : ""}>
          <summary class="cursor-pointer list-none">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold break-words">${d.description}${rest === 0 ? html`<span class="badge badge-ok">quitada</span>` : ""}</div>
                <div class="mt-0.5 text-xs muted">${d.creditor || "—"} · ${methodLabel(d.payment_method)}${d.card_name ? ` · ${d.card_name}` : ""}${d.interest_rate ? ` · ${String(d.interest_rate).replace(".", ",")}% a.m.` : ""}</div>
              </div>
              <div class="shrink-0 text-right"><div class="num font-bold whitespace-nowrap">${money(rest)}</div><div class="text-xs whitespace-nowrap muted">de ${money(d.total_amount)}</div></div>
            </div>
            <div class="mt-3">${progress((paid.length / d.installments_count) * 100)}</div>
            <div class="mt-1.5 flex items-center justify-between text-xs muted">
              <span>${paid.length}/${d.installments_count} parcelas pagas</span>
              <span class="flex items-center gap-1">parcelas ${icon("chevron-down", "size-3.5 transition group-open:rotate-180")}</span>
            </div>
          </summary>
          <div class="mt-4 list border-t border-slate-100 pt-3 dark:border-slate-800">${d.installments.map(
            (i) => html`<div class="list-row !py-2.5" data-inst="${i.id}" data-paid="${i.paid ? 1 : 0}" ${shown(d).has(i.id) ? "" : "hidden"}>
              <div class="min-w-0 flex-1">
                <div class="text-sm font-semibold">${i.number}/${d.installments_count}</div>
                <div class="text-xs muted">vence ${fmtDate(i.due_date)}<span class="hidden sm:inline"> · ${fmtMonth(i.competence)}</span></div>
              </div>
              <div class="shrink-0 text-right">
                <div class="num text-sm font-semibold whitespace-nowrap">${money(i.amount)}</div>
                <div class="mt-0.5">${statusBadge(i.paid)}</div>
              </div>
              ${d.card ? "" : html`<button class="btn btn-sm w-20 shrink-0 justify-center" data-pay>${i.paid ? "Desfazer" : "Pagar"}</button>`}
            </div>`
          )}</div>
          ${d.installments.length > shown(d).size
            ? html`<button type="button" class="btn btn-sm mt-3 w-full justify-center" data-all>${icon("list", "size-3.5")}Ver todas as ${d.installments.length} parcelas</button>`
            : ""}
          <div class="mt-4 flex justify-end gap-2">
            <button class="btn btn-sm" data-edit>${icon("pencil", "size-3.5")}Editar</button>
            <button class="btn btn-sm btn-danger" data-del>${icon("trash-2", "size-3.5")}Excluir</button>
          </div>
        </details>`;
      })}
    </div>`;

  el.querySelector("[data-new]").addEventListener("click", async () => {
    await openExpenseForm({ kind: "divida" });
    render(container);
  });
  el.addEventListener("click", async (e) => {
    const box = e.target.closest("[data-id]");
    if (!box) return;
    const debt = debts.find((d) => String(d.id) === box.dataset.id);
    if (e.target.closest("[data-all]")) {
      showAll.add(debt.id);
      box.querySelectorAll("[data-inst][hidden]").forEach((row) => (row.hidden = false));
      e.target.closest("[data-all]").remove();
    } else if (e.target.closest("[data-pay]")) {
      const row = e.target.closest("[data-inst]");
      await api.post(`installments/${row.dataset.inst}/pay/`, { paid: row.dataset.paid !== "1" });
      toast("Parcela atualizada");
      render(container, { openId: debt.id });
    } else if (e.target.closest("[data-edit]")) {
      await openExpenseForm({ expense: debt });
      render(container, { openId: debt.id });
    } else if (e.target.closest("[data-del]")) {
      if (!(await confirmDialog(`Excluir a dívida "${debt.description}" e suas parcelas?`, { okLabel: "Excluir" }))) return;
      await api.del(`expenses/${debt.id}/`);
      toast("Dívida excluída");
      render(container);
    }
  });
}
