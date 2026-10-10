import { api } from "./api.js";

/** Cache simples dos cadastros usados em formulários e filtros. */
export const store = {
  meta: null,
  blocks: [],
  natures: [],
  categories: [],
  cards: [],
  incomeSources: [],
};

export async function loadMeta() {
  if (!store.meta) store.meta = await api.get("meta/");
  return store.meta;
}

export async function refresh(...keys) {
  const loaders = {
    blocks: () => api.get("blocks/"),
    natures: () => api.get("natures/"),
    categories: () => api.get("categories/"),
    cards: () => api.get("cards/"),
    incomeSources: () => api.get("income-sources/"),
  };
  const targets = keys.length ? keys : Object.keys(loaders);
  const results = await Promise.all(targets.map((k) => loaders[k]()));
  targets.forEach((k, i) => (store[k] = results[i]));
}

export const methodLabel = (value) => store.meta?.payment_methods.find((m) => m.value === value)?.label || value;
export const kindLabel = (value) => store.meta?.expense_kinds.find((m) => m.value === value)?.label || value;
export const DEBT_CATEGORY = "Empréstimos e financiamentos";
/** Grupos ativos de um uso: "gasto" (dia a dia), "divida" ou "investimento". */
export const activeCategories = (scope = "gasto") => store.categories.filter((c) => c.active && c.scope === scope);
export const activeCards = () => store.cards.filter((c) => c.active);
