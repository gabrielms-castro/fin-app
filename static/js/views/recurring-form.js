import { api } from "../api.js";
import { categorySelect, field, options, readForm } from "../components/form.js";
import { openModal, toast } from "../components/modal.js";
import { currentMonth, html } from "../format.js";
import { activeCards, activeCategories, store } from "../state.js";

/** Serviços comuns e o grupo de gasto sugerido para cada um. */
export const SUBSCRIPTION_PRESETS = [
  ["Netflix", "Assinaturas e apps"],
  ["Max (HBO)", "Assinaturas e apps"],
  ["Prime Video", "Assinaturas e apps"],
  ["Amazon Prime", "Assinaturas e apps"],
  ["Disney+", "Assinaturas e apps"],
  ["Globoplay", "Assinaturas e apps"],
  ["Apple TV+", "Assinaturas e apps"],
  ["Paramount+", "Assinaturas e apps"],
  ["Crunchyroll", "Assinaturas e apps"],
  ["Spotify", "Assinaturas e apps"],
  ["YouTube Premium", "Assinaturas e apps"],
  ["Deezer", "Assinaturas e apps"],
  ["Apple Music", "Assinaturas e apps"],
  ["iCloud+", "Assinaturas e apps"],
  ["Google One / Drive", "Assinaturas e apps"],
  ["Microsoft 365", "Assinaturas e apps"],
  ["ChatGPT Plus", "Assinaturas e apps"],
  ["Claude Pro", "Assinaturas e apps"],
  ["Abacus AI", "Assinaturas e apps"],
  ["Xbox Game Pass", "Assinaturas e apps"],
  ["PlayStation Plus", "Assinaturas e apps"],
  ["Kindle Unlimited", "Cursos e livros"],
  ["Duolingo", "Cursos e livros"],
  ["Alura", "Cursos e livros"],
  ["TotalPass", "Bem-estar e beleza"],
  ["Wellhub (Gympass)", "Bem-estar e beleza"],
  ["Smart Fit", "Bem-estar e beleza"],
  ["Uber One", "Transporte"],
  ["99 Plus", "Transporte"],
  ["iFood Clube", "Restaurantes e delivery"],
  ["Rappi Turbo", "Restaurantes e delivery"],
  ["Meli+ (Mercado Livre)", "Assinaturas e apps"],
  ["Anuidade do cartão", "Juros e tarifas"],
];

const SUBSCRIPTION_CATEGORY = "Assinaturas e apps";

/** Grupo da assinatura: o do serviço conhecido ou, se não houver, "Assinaturas e apps". */
const subscriptionCategory = (name) => {
  const preset = SUBSCRIPTION_PRESETS.find(([n]) => n.toLowerCase() === String(name || "").trim().toLowerCase());
  const byName = (n) => activeCategories().find((c) => c.name === n);
  return (preset && byName(preset[1])) || byName(SUBSCRIPTION_CATEGORY) || activeCategories()[0];
};

/** Formulário de conta fixa (kind=conta) ou assinatura (kind=assinatura). */
export function openRecurringForm(item, kind, onSaved) {
  const isSub = (item?.kind || kind) === "assinatura";
  const defaults = isSub
    ? { kind, frequency: "mensal", day: 10, payment_method: "credito", active: true, start_month: currentMonth() }
    : { kind, frequency: "mensal", day: 10, payment_method: "boleto", active: true, start_month: currentMonth() };
  const values = { ...defaults, ...item };
  if (isSub && !values.category) values.category = subscriptionCategory(values.description)?.id;
  // Na assinatura nova, o grupo segue o serviço digitado até o usuário escolher um.
  let pickedByUser = Boolean(item);

  const content = html`
    ${isSub
      ? html`<datalist id="subscription-presets">${SUBSCRIPTION_PRESETS.map(([n]) => html`<option value="${n}"></option>`)}</datalist>`
      : ""}
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      ${field({ name: "description", label: isSub ? "Serviço" : "Descrição", required: true, full: true, placeholder: isSub ? "Netflix, Spotify, TotalPass…" : "Aluguel, internet, condomínio…", list: isSub ? "subscription-presets" : undefined }, values.description)}
      ${isSub
        ? html`${categorySelect("category", activeCategories(), values.category)}<p class="hint -mt-2 sm:col-span-2">Sugerido pelo serviço. Troque se for um gasto essencial — ex.: Saúde, Educação.</p>`
        : ""}
      ${field({ name: "amount", label: "Valor", type: "money", required: true, placeholder: "0,00" }, values.amount)}
      ${field({ name: "frequency", label: "Cobrança", type: "seg", options: store.meta.frequencies }, values.frequency)}
      ${field({ name: "day", label: "Dia da cobrança", type: "number", min: 1, max: 31, required: true }, values.day)}
      ${field({ name: "payment_method", label: "Forma de pagamento", type: "seg", options: store.meta.payment_methods, required: true }, values.payment_method)}
      ${field({ name: "card", label: "Cartão", type: "select", empty: "Selecione…", options: options(activeCards()), required: true }, values.card)}
      ${isSub ? "" : categorySelect("category", activeCategories(), values.category)}
      ${field({ name: "start_month", label: isSub ? "Assinante desde" : "Início", type: "month", required: true, hint: "Na cobrança anual, o mês de início define o mês de renovação." }, values.start_month)}
      ${field({ name: "end_month", label: "Fim (opcional)", type: "month" }, values.end_month)}
      ${field({ name: "active", label: "Ativa", type: "checkbox" }, values.active)}
    </div>
    <p class="mt-4 hint">Lançada automaticamente em cada cobrança até o mês atual; as futuras entram na projeção.</p>`;

  openModal({
    title: `${item ? "Editar" : "Nova"} ${isSub ? "assinatura" : "conta fixa"}`,
    content,
    onOpen: (form) => {
      const sync = (e) => {
        form.querySelector('[data-field="card"]').hidden = form.querySelector('[name="payment_method"]:checked')?.value !== "credito";
        // O grupo da assinatura acompanha o serviço digitado.
        if (isSub && e?.target === form.category && e.isTrusted) pickedByUser = true;
        if (isSub && !pickedByUser && e?.target === form.description) {
          form.category.value = subscriptionCategory(form.description.value)?.id ?? "";
          // Avisa o seletor para atualizar natureza e bloco.
          form.category.dispatchEvent(new Event("change", { bubbles: true }));
        }
      };
      form.addEventListener("input", sync);
      form.addEventListener("change", sync);
      sync();
    },
    onSubmit: async (form) => {
      const data = { ...readForm(form), kind: values.kind };
      if (data.payment_method !== "credito") data.card = null;
      await api.save("recurring", { ...data, id: item?.id });
      toast(isSub ? "Assinatura salva" : "Conta salva");
      onSaved();
    },
  });
}

