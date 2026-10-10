import { api } from "../api.js";
import { confirmDialog, toast } from "../components/modal.js";
import { fmtDate, html, money } from "../format.js";
import { icon } from "../icons.js";
import { methodLabel, store } from "../state.js";
import { editDelete, empty, iconButton, kpi, pageHead } from "../ui.js";
import { openRecurringForm } from "./recurring-form.js";

const COLS = "md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)_auto]";

export async function render(container, { query }) {
  const el = document.createElement("div");
  container.replaceChildren(el);
  const subs = await api.get("recurring/", { kind: "assinatura" });
  const filter = { card: query.card || "", status: query.status || "ativas" };
  const reload = () => render(container, { query: filter });

  const active = subs.filter((s) => s.active);
  const monthly = active.reduce((t, s) => t + s.monthly_amount, 0);
  const upcoming = active.filter((s) => s.next_charge).sort((a, b) => a.next_charge.localeCompare(b.next_charge))[0];
  const byCard = new Map();
  active.forEach((s) => {
    const key = s.card_name || methodLabel(s.payment_method);
    const cur = byCard.get(key) || { total: 0, color: s.card_color || "#94a3b8" };
    cur.total += s.monthly_amount;
    byCard.set(key, cur);
  });

  const visible = subs.filter(
    (s) =>
      (filter.status === "todas" || (filter.status === "ativas" ? s.active : !s.active)) &&
      (!filter.card || String(s.card) === filter.card)
  );

  el.innerHTML = html`
    ${pageHead("Assinaturas", html`<button class="btn btn-primary" data-new>${icon("plus")}Assinatura</button>`)}
    <div class="stack">
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        ${kpi("Total mensal", money(monthly), { iconName: "repeat" })}
        ${kpi("Total no ano", money(monthly * 12), { iconName: "calendar" })}
        ${kpi("Ativas", String(active.length), { iconName: "monitor-play", sub: subs.length > active.length ? `${subs.length - active.length} pausada(s)` : "" })}
        ${kpi("Próxima cobrança", upcoming ? fmtDate(upcoming.next_charge) : "—", { iconName: "calendar-clock", sub: upcoming ? `${upcoming.description} · ${money(upcoming.amount)}` : "" })}
      </div>

      ${byCard.size
        ? html`<div class="flex flex-wrap gap-2">${[...byCard].map(
            ([name, v]) => html`<span class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900">
              <span class="dot" style="background:${v.color}"></span>${name}<b class="num">${money(v.total)}</b><span class="text-xs muted">/mês</span></span>`
          )}</div>`
        : ""}

      <div class="card">
        <div class="mb-4 flex flex-wrap items-center gap-2">
          <div class="seg-group" data-status>
            ${["ativas", "pausadas", "todas"].map(
              (s) => html`<label class="pill"><input type="radio" name="status" value="${s}" ${filter.status === s ? "checked" : ""}><span class="capitalize">${s}</span></label>`
            )}
          </div>
          <select class="input ml-auto !h-9 w-auto" data-card aria-label="Filtrar por cartão">
            <option value="">Todos os cartões</option>
            ${store.cards.map((c) => html`<option value="${c.id}" ${String(c.id) === filter.card ? "selected" : ""}>${c.name}</option>`)}
          </select>
        </div>
        <div class="list-head ${COLS} gap-x-4"><span>Serviço</span><span>Cartão</span><span class="text-right">Valor</span><span>Tipo</span><span>Próxima</span><span class="w-28"></span></div>
        ${visible.length ? "" : empty(subs.length ? "Nenhuma assinatura neste filtro." : "Cadastre Netflix, Spotify, TotalPass… para acompanhar quanto elas somam.", "monitor-play")}
        <div class="list">${visible.map(
          (s) => html`<div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 py-3 ${COLS} ${s.active ? "" : "opacity-60"}" data-id="${s.id}">
            <div class="flex min-w-0 items-center gap-3">
              <span class="grid size-9 shrink-0 place-items-center rounded-lg bg-indigo-50 text-sm font-bold text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300">${s.description.charAt(0).toUpperCase()}</span>
              <div class="min-w-0"><div class="truncate font-medium">${s.description}</div>
                <div class="text-xs muted md:hidden">${s.card_name || methodLabel(s.payment_method)} · ${s.category_name}</div></div>
            </div>
            <div class="num text-right md:order-3"><div class="font-semibold">${money(s.amount)}</div><div class="text-xs muted">${s.frequency === "anual" ? `anual · ${money(s.monthly_amount)}/mês` : "mensal"}</div></div>
            <div class="hidden items-center gap-2 text-sm md:order-2 md:flex"><span class="dot" style="background:${s.card_color || "#94a3b8"}"></span>${s.card_name || methodLabel(s.payment_method)}</div>
            <div class="hidden md:order-4 md:block"><span class="badge">${s.category_name}</span></div>
            <div class="text-xs muted md:order-5 md:text-sm">${s.active ? (s.next_charge ? html`${icon("calendar", "size-3.5 inline -mt-0.5")} ${fmtDate(s.next_charge)}` : "—") : html`<span class="badge">pausada</span>`}</div>
            <div class="-mr-2 flex justify-end md:order-6">
              ${iconButton("toggle", s.active ? "pause" : "play", s.active ? "Pausar" : "Reativar")}
              ${editDelete()}
            </div>
          </div>`
        )}</div>
      </div>
    </div>`;

  el.querySelector("[data-new]").addEventListener("click", () => openRecurringForm(null, "assinatura", reload));
  el.querySelector("[data-status]").addEventListener("change", (e) => {
    filter.status = e.target.value;
    reload();
  });
  el.querySelector("[data-card]").addEventListener("change", (e) => {
    filter.card = e.target.value;
    reload();
  });
  el.addEventListener("click", async (e) => {
    const row = e.target.closest("[data-id]");
    if (!row) return;
    const sub = subs.find((s) => String(s.id) === row.dataset.id);
    if (e.target.closest("[data-toggle]")) {
      await api.patch(`recurring/${sub.id}/`, { active: !sub.active });
      toast(sub.active ? "Assinatura pausada" : "Assinatura reativada");
      reload();
    } else if (e.target.closest("[data-edit]")) {
      openRecurringForm(sub, "assinatura", reload);
    } else if (e.target.closest("[data-del]")) {
      const ok = await confirmDialog(
        `Excluir "${sub.description}"? As cobranças já lançadas são mantidas. Para parar de cobrar, você também pode pausar.`,
        { okLabel: "Excluir" }
      );
      if (!ok) return;
      await api.del(`recurring/${sub.id}/`);
      toast("Assinatura excluída");
      reload();
    }
  });
}
