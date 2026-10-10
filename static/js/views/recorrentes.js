import { api } from "../api.js";
import { confirmDialog, toast } from "../components/modal.js";
import { fmtDate, fmtMonth, html, money } from "../format.js";
import { icon } from "../icons.js";
import { methodLabel } from "../state.js";
import { editDelete, empty, iconButton, pageHead } from "../ui.js";
import { openRecurringForm } from "./recurring-form.js";

export async function render(container) {
  const el = document.createElement("div");
  container.replaceChildren(el);
  const items = await api.get("recurring/", { kind: "conta" });
  const total = items.filter((i) => i.active).reduce((s, i) => s + i.monthly_amount, 0);
  const reload = () => render(container);

  el.innerHTML = html`
    ${pageHead("Contas fixas", html`<button class="btn btn-primary" data-new>${icon("plus")}Conta</button>`)}
    <div class="card">
      <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p class="text-sm muted">Aluguel, condomínio, energia, internet… Assinaturas ficam em <a href="#/assinaturas" class="font-medium text-indigo-600 dark:text-indigo-400">Assinaturas</a>.</p>
        <span class="text-sm">Total mensal <b class="num">${money(total)}</b></span>
      </div>
      ${items.length ? "" : empty("Nenhuma conta fixa cadastrada.", "repeat")}
      <div class="list">${items.map(
        (i) => html`<div class="list-row ${i.active ? "" : "opacity-60"}" data-id="${i.id}">
          <span class="hidden size-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-500 sm:grid dark:bg-slate-800 dark:text-slate-400">${icon("repeat", "size-5")}</span>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 font-medium">${i.description}${i.active ? "" : html`<span class="badge">inativa</span>`}</div>
            <div class="text-xs muted">dia ${i.day} · ${i.category_name} · ${methodLabel(i.payment_method)}${i.card_name ? ` · ${i.card_name}` : ""} · desde ${fmtMonth(i.start_month)}${i.end_month ? ` até ${fmtMonth(i.end_month)}` : ""}${i.next_charge ? ` · próxima ${fmtDate(i.next_charge)}` : ""}</div>
          </div>
          <div class="flex flex-col items-end gap-1">
            <span class="num font-semibold">${money(i.amount)}${i.frequency === "anual" ? html`<span class="text-xs font-normal muted">/ano</span>` : ""}</span>
            <div class="-mr-2 flex">${iconButton("toggle", i.active ? "pause" : "play", i.active ? "Desativar" : "Reativar")}${editDelete()}</div>
          </div>
        </div>`
      )}</div>
    </div>`;

  el.querySelector("[data-new]").addEventListener("click", () => openRecurringForm(null, "conta", reload));
  el.addEventListener("click", async (e) => {
    const row = e.target.closest("[data-id]");
    if (!row) return;
    const item = items.find((i) => String(i.id) === row.dataset.id);
    if (e.target.closest("[data-toggle]")) {
      await api.patch(`recurring/${item.id}/`, { active: !item.active });
      reload();
    } else if (e.target.closest("[data-edit]")) {
      openRecurringForm(item, "conta", reload);
    } else if (e.target.closest("[data-del]")) {
      const ok = await confirmDialog("Excluir a conta fixa? Os lançamentos já gerados são mantidos.", { okLabel: "Excluir" });
      if (!ok) return;
      await api.del(`recurring/${item.id}/`);
      toast("Conta excluída");
      reload();
    }
  });
}
