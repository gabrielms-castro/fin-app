import { api } from "../api.js";
import { fmtDate, fmtMonth, html, money } from "../format.js";
import { icon } from "../icons.js";
import { kindLabel, methodLabel, store } from "../state.js";
import { statusBadge } from "../ui.js";
import { openExpenseForm } from "../views/expense-form.js";
import { confirmDialog, openModal, toast } from "./modal.js";

/** Lançamentos gerenciados em outra tela: o detalhe mostra só um link para lá. */
export const OWN_TAB = {
  divida: { href: "#/dividas", label: "Abrir em Dívidas" },
  investimento: { href: "#/investimentos", label: "Abrir em Investimentos" },
  meta: { href: "#/metas", label: "Abrir em Metas" },
};

const item = (label, value) =>
  html`<div class="min-w-0"><dt class="text-xs muted">${label}</dt><dd class="mt-0.5 text-sm font-medium break-words">${value}</dd></div>`;

function content(e, installmentId) {
  const block = store.blocks.find((b) => b.id === e.block);
  const count = e.installments_count;
  const installments = e.installments || [];
  const paidTotal = installments.filter((i) => i.paid).reduce((t, i) => t + Number(i.amount), 0);
  const own = OWN_TAB[e.kind];
  return html`
    <div class="space-y-5">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="text-lg font-semibold break-words">${e.description}</div>
          <div class="mt-1 flex flex-wrap items-center gap-1.5">
            <span class="badge badge-info">${kindLabel(e.kind)}</span>
            ${count > 1 ? html`<span class="badge">${count}x</span>` : html`<span class="badge">à vista</span>`}
          </div>
        </div>
        <div class="text-right">
          <div class="num text-2xl font-bold">${money(e.total_amount)}</div>
          ${count > 1 ? html`<div class="text-xs muted">${count}x de ${money(installments[0]?.amount ?? e.installment_amount)}</div>` : ""}
        </div>
      </div>

      <dl class="grid grid-cols-2 gap-x-4 gap-y-3">
        ${item(e.kind === "divida" ? "Data da contratação" : "Data da compra", fmtDate(e.date))}
        ${item("Forma de pagamento", methodLabel(e.payment_method))}
        ${e.card_name ? item("Cartão", e.card_name) : ""}
        ${item("Grupo", e.category_name)}
        ${item("Natureza", e.nature_name)}
        ${item("Bloco", html`<span class="inline-flex items-center gap-1.5"><span class="dot" style="background:${block?.color || "#94a3b8"}"></span>${e.block_name}</span>`)}
        ${e.creditor ? item("Credor", e.creditor) : ""}
        ${e.interest_rate ? item("Juros", `${Number(e.interest_rate).toLocaleString("pt-BR")}% a.m.`) : ""}
        ${e.notes ? html`<div class="col-span-2">${item("Observações", e.notes)}</div>` : ""}
      </dl>

      <div>
        <div class="mb-2 flex items-center justify-between gap-2 text-sm font-semibold">
          <span>${count > 1 ? "Parcelas" : "Pagamento"}</span>
          <span class="text-xs font-normal muted">${e.paid_count}/${count} paga(s) · ${money(paidTotal)}</span>
        </div>
        <div class="max-h-64 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800">
          <div class="list px-3">${installments.map(
            (i) => html`<div class="flex items-center gap-3 py-2 text-sm ${i.id === installmentId ? "-mx-3 bg-indigo-50 px-3 dark:bg-indigo-500/10" : ""}" ${i.id === installmentId ? html`aria-current="true"` : ""}>
              <span class="w-12 shrink-0 font-medium">${i.number}/${count}</span>
              <div class="min-w-0 flex-1"><div>${fmtMonth(i.competence)}</div><div class="text-xs muted">vence ${fmtDate(i.due_date)}</div></div>
              <span class="num font-medium">${money(i.amount)}</span>
              ${statusBadge(i.paid)}
            </div>`
          )}</div>
        </div>
      </div>

      ${own
        ? html`<a href="${own.href}" data-own-tab class="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-sm font-medium text-indigo-600 hover:underline dark:bg-slate-800/60 dark:text-indigo-400">
            <span>Este lançamento é gerenciado em outra tela.</span><span class="inline-flex items-center gap-1">${own.label}${icon("arrow-up-right", "size-3.5")}</span></a>`
        : ""}
    </div>`;
}

/**
 * Abre o detalhe de um lançamento (compra) com Editar e Excluir.
 * `installmentId` destaca a parcela clicada; `onChange` roda após editar ou excluir.
 */
export async function openExpenseDetail({ expenseId, installmentId = null, onChange = () => {} }) {
  const expense = await api.get(`expenses/${expenseId}/`);
  const own = OWN_TAB[expense.kind];
  const { close } = openModal({
    title: "Detalhes do lançamento",
    content: content(expense, Number(installmentId) || null),
    cancelLabel: "Fechar",
    submitLabel: html`${icon("pencil")}Editar`,
    footerStart: own ? "" : html`<button type="button" class="btn btn-danger flex-1 sm:flex-none" data-del>${icon("trash-2")}Excluir</button>`,
    onSubmit: own
      ? undefined
      : async () => {
          // Fecha o detalhe e abre o formulário; só recarrega se salvar.
          openExpenseForm({ expense }).then(onChange);
        },
    onOpen: (form) => {
      form.querySelector("[data-own-tab]")?.addEventListener("click", () => close());
      form.querySelector("[data-del]")?.addEventListener("click", async () => {
        const ok = await confirmDialog("Excluir este lançamento e todas as suas parcelas?", { okLabel: "Excluir" });
        if (!ok) return;
        try {
          await api.del(`expenses/${expense.id}/`);
        } catch (err) {
          toast(err.message, true);
          return;
        }
        close();
        toast("Lançamento excluído");
        onChange();
      });
    },
  });
}
