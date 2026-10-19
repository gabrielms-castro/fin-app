import { api } from "../api.js";
import { fields, options, readForm } from "../components/form.js";
import { setButtonLoading } from "../components/loading.js";
import { confirmDialog, openModal, showErrors, toast } from "../components/modal.js";
import { html, money } from "../format.js";
import { icon } from "../icons.js";
import { refresh, store } from "../state.js";
import { editDelete, pageHead } from "../ui.js";

const FORMS = {
  blocks: {
    title: "bloco",
    specs: () => [
      { name: "name", label: "Nome", required: true, full: true },
      { name: "kind", label: "Tipo", type: "seg", options: store.meta.block_kinds, required: true },
      { name: "value", label: "Valor (% ou R$)", type: "number", step: "0.01", min: 0, required: true },
      { name: "color", label: "Cor", type: "color" },
      { name: "order", label: "Ordem", type: "number", min: 0 },
    ],
    defaults: { kind: "percent", color: "#6366f1", order: 0 },
  },
  natures: {
    title: "natureza",
    specs: () => [
      { name: "name", label: "Nome", required: true, full: true },
      { name: "block", label: "Bloco do orçamento", type: "select", required: true, options: options(store.blocks), full: true },
      { name: "order", label: "Ordem", type: "number", min: 0 },
    ],
    defaults: { order: 0 },
  },
  categories: {
    title: "grupo de gasto",
    specs: () => [
      { name: "name", label: "Nome", required: true },
      { name: "nature", label: "Natureza", type: "select", required: true, options: options(store.natures), hint: "Define a natureza e o bloco dos lançamentos deste grupo" },
      {
        name: "scope", label: "Uso", type: "seg", options: store.meta.category_scopes, required: true,
        hint: "Gastos: lançamentos, contas fixas e assinaturas. Dívidas e Investimentos: só nas abas próprias.",
      },
      { name: "description", label: "O que entra aqui", full: true },
      { name: "active", label: "Ativo", type: "checkbox" },
    ],
    defaults: { active: true, scope: "gasto" },
  },
};

const SCOPE_ICON = { divida: "landmark", investimento: "piggy-bank" };
const scopeBadge = (c) =>
  SCOPE_ICON[c.scope]
    ? html`<span class="badge badge-info">${icon(SCOPE_ICON[c.scope], "size-3")}${store.meta.category_scopes.find((x) => x.value === c.scope).label}</span>`
    : "";

function openForm(resource, item, onSaved, defaults = {}) {
  const cfg = FORMS[resource];
  openModal({
    title: `${item ? "Editar" : "Novo"} ${cfg.title}`,
    content: fields(cfg.specs(), { ...cfg.defaults, ...defaults, ...item }),
    onSubmit: async (form) => {
      const data = readForm(form);
      if (data.order === null) data.order = 0;
      await api.save(resource, { ...data, id: item?.id });
      await refresh("blocks", "natures", "categories");
      toast("Salvo");
      onSaved();
    },
  });
}

export async function render(container) {
  const el = document.createElement("div");
  container.replaceChildren(el);
  const [settings] = await Promise.all([api.get("settings/"), refresh("blocks", "natures", "categories")]);
  const reload = () => render(container);
  const percentTotal = store.blocks.filter((b) => b.kind === "percent").reduce((s, b) => s + Number(b.value), 0);

  const actions = (resource, id) => html`<div class="-mr-2 flex" data-resource="${resource}" data-id="${id}">${editDelete()}</div>`;
  const blockValue = (b) => (b.kind === "percent" ? `${Number(b.value).toLocaleString("pt-BR")}%` : money(b.value));

  el.innerHTML = html`
    ${pageHead(
      "Configurações",
<button class="btn" data-apply-defaults>${icon("sparkles")}Aplicar estrutura 50/30/20</button>`
    )}
    <div class="stack">
      <div class="card">
        <h2 class="card-title">Teto de parcelados</h2>
        <form class="flex flex-wrap items-end gap-3" data-ceiling novalidate>
          <label class="field w-40">% máximo da renda
            <div class="relative"><input class="input pr-7 text-right" type="number" name="installment_ceiling_pct" min="0" max="100" step="1" inputmode="numeric" value="${Number(settings.installment_ceiling_pct)}" required><span class="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm muted">%</span></div>
          </label>
          <button class="btn btn-primary" type="submit">Salvar</button>
          <p class="hint basis-full">Soma das parcelas de compras parceladas (2x ou mais) de cada mês, em qualquer forma de pagamento. Dívidas ficam de fora. Acima do teto, o dashboard e o formulário de lançamento avisam.</p>
        </form>
      </div>

      <div class="card">
        <h2 class="card-title">Blocos do salário
          <button class="btn btn-sm" data-new="blocks">${icon("plus", "size-3.5")}Bloco</button></h2>
        <p class="mb-4 text-sm muted">Cada bloco recebe uma fatia da entrada esperada. As naturezas apontam para os blocos e os grupos de gasto apontam para as naturezas.
          ${percentTotal !== 100 ? html`<span class="badge badge-warn">soma dos % = ${percentTotal.toLocaleString("pt-BR")}%</span>` : ""}</p>
        <div class="grid gap-4 lg:grid-cols-3">
          ${store.blocks.map((b) => {
            const natures = store.natures.filter((n) => n.block === b.id);
            return html`<div class="rounded-xl border border-slate-200 p-4 dark:border-slate-700" style="border-top:4px solid ${b.color}">
              <div class="flex items-start justify-between gap-2">
                <div><div class="font-semibold">${b.name}</div><div class="num text-2xl font-bold">${blockValue(b)}</div></div>
                ${actions("blocks", b.id)}
              </div>
              <div class="mt-3 space-y-3">${natures.map((n) => {
                const cats = store.categories.filter((c) => c.nature === n.id);
                return html`<div>
                  <div class="flex items-center justify-between text-sm font-medium">${n.name}${actions("natures", n.id)}</div>
                  <div class="mt-1 flex flex-wrap gap-1">${cats.map(
                    (c) => html`<button type="button" class="badge cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 ${c.active ? "" : "line-through opacity-60"}" data-cat="${c.id}" title="${c.description}">${c.scope === "divida" ? icon("landmark", "size-3") : c.scope === "investimento" ? icon("piggy-bank", "size-3") : ""}${c.name}</button>`
                  )}<button type="button" class="badge badge-info cursor-pointer" data-new-cat="${n.id}">${icon("plus", "size-3")}grupo</button></div>
                </div>`;
              })}
              ${natures.length ? "" : html`<p class="text-sm muted">Sem naturezas.</p>`}</div>
            </div>`;
          })}
        </div>
        <button class="btn btn-sm mt-4" data-new="natures">${icon("plus", "size-3.5")}Natureza</button>
      </div>

      <div class="card">
        <h2 class="card-title">Grupos de gasto <button class="btn btn-sm" data-new="categories">${icon("plus", "size-3.5")}Grupo</button></h2>
        <div class="list">${store.categories.map(
          (c) => html`<div class="list-row ${c.active ? "" : "opacity-60"}">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2 font-medium">${c.name}<span class="badge">${c.nature_name} → ${c.block_name}</span>${scopeBadge(c)}${c.active ? "" : html`<span class="badge">inativo</span>`}</div>
              <div class="text-xs muted">${c.description}</div>
            </div>
            ${actions("categories", c.id)}
          </div>`
        )}</div>
      </div>
    </div>`;

  el.querySelector("[data-ceiling]").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    if (!form.reportValidity()) return;
    const button = form.querySelector("[type=submit]");
    setButtonLoading(button, true);
    try {
      await api.patch("settings/", { installment_ceiling_pct: form.installment_ceiling_pct.value });
      toast("Teto de parcelados salvo");
    } catch (err) {
      showErrors(form, err);
    } finally {
      setButtonLoading(button, false);
    }
  });

  el.addEventListener("click", async (e) => {
    const t = e.target;
    if (t.closest("[data-apply-defaults]")) {
      const ok = await confirmDialog(
        "Aplicar a estrutura padrão 50/30/20? Blocos e grupos são renomeados/reorganizados e os lançamentos existentes são mantidos e migrados para os novos grupos. Grupos que você criou são preservados.",
        { okLabel: "Aplicar", danger: false }
      );
      if (!ok) return;
      await api.post("apply-defaults/");
      toast("Estrutura aplicada");
      return reload();
    }
    const newBtn = t.closest("[data-new]");
    if (newBtn) return openForm(newBtn.dataset.new, null, reload);
    const newCat = t.closest("[data-new-cat]");
    if (newCat) return openForm("categories", null, reload, { nature: newCat.dataset.newCat });
    const cat = t.closest("[data-cat]");
    if (cat) return openForm("categories", store.categories.find((c) => String(c.id) === cat.dataset.cat), reload);

    const holder = t.closest("[data-resource]");
    if (!holder) return;
    const { resource, id } = holder.dataset;
    if (t.closest("[data-edit]")) {
      openForm(resource, store[resource].find((i) => String(i.id) === id), reload);
    } else if (t.closest("[data-del]")) {
      if (!(await confirmDialog("Excluir este item?", { okLabel: "Excluir" }))) return;
      try {
        await api.del(`${resource}/${id}/`);
        await refresh("blocks", "natures", "categories");
        toast("Excluído");
        reload();
      } catch (err) {
        toast(err.status === 409 ? "Em uso — reatribua ou desative antes de excluir." : err.message, true);
      }
    }
  });
}
