import { api } from "../api.js";
import { categoryField, field, fields, options, readForm } from "../components/form.js";
import { openModal, toast } from "../components/modal.js";
import { fmtMonth, html, money, todayISO } from "../format.js";
import { icon } from "../icons.js";
import { DEBT_CATEGORY, activeCards, activeCategories, store } from "../state.js";

/** Campos mantidos em "Salvar e lançar outro" (o resto volta ao padrão). */
const KEEP_ON_NEXT = new Set(["date", "payment_method", "card", "category", "kind", "amount_mode", "creditor", "interest_rate"]);

/**
 * Formulário de compra/dívida. Retorna uma Promise resolvida ao fechar o modal depois de
 * salvar ao menos um lançamento (com o último salvo). Em lançamento novo, "Salvar e lançar
 * outro" salva e limpa o formulário mantendo data, forma de pagamento, cartão e grupo.
 */
export function openExpenseForm({ expense = null, kind = "compra", defaults = {} } = {}) {
  const isDebt = (expense?.kind || kind) === "divida";
  const values = {
    kind: isDebt ? "divida" : expense?.kind || kind,
    date: todayISO(),
    installments_count: 1,
    payment_method: isDebt ? "boleto" : "pix",
    ...defaults,
    ...(expense || {}),
  };
  values.amount_mode = !expense || expense.installment_amount ? "installment" : "total";
  if (!values.category && isDebt) values.category = store.categories.find((c) => c.name === DEBT_CATEGORY)?.id;

  const content = html`
    <div class="space-y-4">
      <div class="flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm" data-batch-status role="status" aria-live="polite" hidden></div>
      ${fields(
        [
          { name: "description", label: "Descrição", required: true, full: true, placeholder: isDebt ? "Empréstimo, financiamento…" : "Mercado, Uber…" },
          ...(isDebt
            ? [
                { name: "creditor", label: "Credor", placeholder: "Banco, financeira…" },
                { name: "interest_rate", label: "Juros (% a.m.)", type: "number", step: "0.001", min: 0 },
                {
                  name: "amount_mode", label: "Informar", type: "seg",
                  options: [{ value: "installment", label: "Valor da parcela" }, { value: "total", label: "Valor total" }],
                },
              ]
            : []),
        ],
        values
      )}
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        ${field({ name: "total_amount", label: "Valor total", type: "money", required: !isDebt, placeholder: "0,00" }, values.total_amount)}
        ${isDebt ? field({ name: "installment_amount", label: "Valor da parcela", type: "money", required: true, placeholder: "0,00" }, values.installment_amount) : ""}
        ${field({ name: "date", label: isDebt ? "Data da contratação" : "Data da compra", type: "date", required: true }, values.date)}
        ${field({ name: "payment_method", label: "Forma de pagamento", type: "seg", options: store.meta.payment_methods, required: true }, values.payment_method)}
        ${field({ name: "card", label: "Cartão", type: "select", empty: "Selecione…", options: options(activeCards()), required: true }, values.card)}
        ${field({ name: "installments_count", label: "Parcelas", type: "number", min: 1, max: 480, required: true }, values.installments_count)}
        ${field({ name: "first_due_date", label: "1º vencimento (opcional)", type: "date", hint: "No crédito vale o mês da fatura. Vazio = calculado pelo fechamento." }, values.first_due_date)}
        ${categoryField("category", activeCategories(isDebt ? "divida" : "gasto"), values.category)}
        ${field({ name: "notes", label: "Observações", type: "textarea" }, values.notes)}
      </div>
      <div class="flex items-start gap-2 rounded-xl bg-indigo-50 px-3 py-2.5 text-sm text-indigo-800 dark:bg-indigo-500/10 dark:text-indigo-200" data-preview hidden></div>
      <div class="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200" data-ceiling-warning role="status" hidden></div>
    </div>`;

  return new Promise((resolve) => {
    let lastSaved = null;
    let savedCount = 0;
    openModal({
      title: expense ? "Editar lançamento" : isDebt ? "Nova dívida" : "Novo lançamento",
      content,
      secondaryLabel: expense ? "" : "Salvar e lançar outro",
      onOpen: (form) => setup(form, isDebt, expense?.id),
      onSubmit: async (form, { action }) => {
        const data = payload(form, values.kind);
        try {
          lastSaved = expense ? await api.put(`expenses/${expense.id}/`, data) : await api.post("expenses/", data);
        } catch (err) {
          // Em sequência o usuário pode nem olhar o formulário: o erro fica visível no topo e no toast.
          batchStatus(form, "error", html`<b>Não foi salvo.</b> ${data.description ? html`"${data.description}" ` : ""}precisa de correção nos campos destacados.${
            savedCount === 1 ? " O anterior está salvo." : savedCount > 1 ? ` Os ${savedCount} anteriores estão salvos.` : ""}`);
          toast(`Erro: "${data.description || "lançamento"}" não foi salvo`, true);
          throw err;
        }
        savedCount += 1;
        const label = `"${data.description}" · ${money(data.total_amount || data.installment_amount)}${
          data.installments_count > 1 ? ` em ${data.installments_count}x` : ""}`;
        if (action !== "secondary") {
          toast(savedCount > 1 ? `${label} salvo · ${savedCount} lançamentos nesta sequência` : `${label} salvo`);
          return false;
        }
        toast(`✓ ${label} salvo`);
        batchStatus(form, "ok", html`<b>${label} salvo.</b> ${
          savedCount > 1 ? `${savedCount} lançamentos nesta sequência. ` : ""}Pode lançar o próximo.`);
        resetForNext(form, values);
        return true;
      },
      onClose: () => lastSaved && resolve(lastSaved),
    });
  });
}

/** Faixa no topo do formulário com o resultado do último envio em sequência. */
function batchStatus(form, kind, message) {
  const el = form.querySelector("[data-batch-status]");
  const ok = kind === "ok";
  el.className = `flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm ${ok
    ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200"
    : "bg-rose-50 text-rose-800 dark:bg-rose-500/10 dark:text-rose-200"}`;
  el.innerHTML = html`${icon(ok ? "circle-check" : "circle-alert", "size-4 mt-0.5 shrink-0")}<span>${message}</span>`;
  el.hidden = false;
  if (!ok) el.scrollIntoView({ block: "nearest" });
}

/** Limpa o formulário para o próximo lançamento, mantendo os campos de KEEP_ON_NEXT. */
function resetForNext(form, values) {
  form.querySelectorAll(".field-error").forEach((el) => el.remove());
  form.querySelectorAll(".input-error").forEach((el) => el.classList.remove("input-error"));
  for (const el of form.elements) {
    if (!el.name || KEEP_ON_NEXT.has(el.name) || el.type === "radio" || el.type === "checkbox") continue;
    if (el.name === "installments_count") el.value = values.installments_count ?? 1;
    else if (el.tagName === "SELECT") el.value = values[el.name] ?? "";
    else el.value = "";
  }
  form.dispatchEvent(new Event("change", { bubbles: true }));
  form.querySelector('[name="description"]')?.focus();
}

function payload(form, kind) {
  const data = readForm(form);
  data.kind = kind;
  if (kind === "divida") {
    if (data.amount_mode === "total") data.installment_amount = null;
    else delete data.total_amount;
  }
  delete data.amount_mode;
  if (data.payment_method !== "credito") data.card = null;
  return data;
}

/** Aviso (não bloqueia) quando as parcelas passam do teto de parcelados em algum mês. */
function ceilingWarning(rows) {
  const over = rows.filter((r) => r.status === "over");
  if (!over.length) return null;
  const shown = over.slice(0, 3).map((r) => html`<b>${fmtMonth(r.month)}</b> (+${money(r.excess)})`);
  const rest = over.length > 3 ? ` e mais ${over.length - 3} mês(es)` : "";
  return html`${icon("triangle-alert", "size-4 mt-0.5")}<span>Esta compra passa do seu teto de parcelados (${Number(over[0].ceiling_pct).toLocaleString("pt-BR")}% da renda) em ${shown.reduce((acc, m, i) => html`${acc}${i ? ", " : ""}${m}`, "")}${rest}. Você ainda pode salvar.</span>`;
}

function setup(form, isDebt, expenseId) {
  const toggle = (name, show) => {
    const label = form.querySelector(`[data-field="${name}"]`);
    if (label) label.hidden = !show;
  };
  const preview = form.querySelector("[data-preview]");
  const warning = form.querySelector("[data-ceiling-warning]");
  let timer;

  const sync = () => {
    const method = form.querySelector('[name="payment_method"]:checked')?.value;
    toggle("card", method === "credito");
    if (method === "credito" && !form.card.value && activeCards().length === 1) form.card.value = activeCards()[0].id;
    if (isDebt) {
      const mode = form.querySelector('[name="amount_mode"]:checked')?.value || "installment";
      toggle("total_amount", mode === "total");
      toggle("installment_amount", mode === "installment");
    }
    clearTimeout(timer);
    timer = setTimeout(updatePreview, 250);
  };

  const updatePreview = async () => {
    const data = payload(form, isDebt ? "divida" : "compra");
    const amount = data.total_amount || data.installment_amount;
    if (!amount || !data.date || !data.category || (data.payment_method === "credito" && !data.card)) {
      preview.hidden = warning.hidden = true;
      return;
    }
    try {
      const { installments, commitment } = await api.post("expenses/preview/", { ...data, id: expenseId, description: data.description || "-" });
      const alert = ceilingWarning(commitment || []);
      warning.innerHTML = alert || "";
      warning.hidden = !alert;
      const first = installments[0];
      const last = installments[installments.length - 1];
      const where = data.payment_method === "credito" ? "Cai na fatura de" : "Conta em";
      preview.innerHTML = html`${icon("calendar-clock", "size-4 mt-0.5")}<span>${where} <b>${fmtMonth(first.competence)}</b>${
        installments.length > 1
          ? html` · ${installments.length}× de <b>${money(last.amount)}</b> até ${fmtMonth(last.competence)}`
          : html` · <b>${money(first.amount)}</b>`
      }</span>`;
      preview.hidden = false;
    } catch {
      preview.hidden = warning.hidden = true;
    }
  };

  form.addEventListener("input", sync);
  form.addEventListener("change", sync);
  sync();
}
