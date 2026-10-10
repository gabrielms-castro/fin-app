import { api } from "../api.js";
import { categoryField, field, fields, options, readForm } from "../components/form.js";
import { openModal, toast } from "../components/modal.js";
import { fmtMonth, html, money, todayISO } from "../format.js";
import { icon } from "../icons.js";
import { DEBT_CATEGORY, activeCards, activeCategories, store } from "../state.js";

/** Formulário de compra/dívida. Retorna uma Promise resolvida quando salvar. */
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
    </div>`;

  return new Promise((resolve) => {
    openModal({
      title: expense ? "Editar lançamento" : isDebt ? "Nova dívida" : "Novo lançamento",
      content,
      onOpen: (form) => setup(form, isDebt),
      onSubmit: async (form) => {
        const data = payload(form, values.kind);
        const saved = expense ? await api.put(`expenses/${expense.id}/`, data) : await api.post("expenses/", data);
        toast("Lançamento salvo");
        resolve(saved);
      },
    });
  });
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

function setup(form, isDebt) {
  const toggle = (name, show) => {
    const label = form.querySelector(`[data-field="${name}"]`);
    if (label) label.hidden = !show;
  };
  const preview = form.querySelector("[data-preview]");
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
      preview.hidden = true;
      return;
    }
    try {
      const { installments } = await api.post("expenses/preview/", { ...data, description: data.description || "-" });
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
      preview.hidden = true;
    }
  };

  form.addEventListener("input", sync);
  form.addEventListener("change", sync);
  sync();
}
