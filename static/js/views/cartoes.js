import { api } from "../api.js";
import { fields, readForm } from "../components/form.js";
import { confirmDialog, openModal, toast } from "../components/modal.js";
import { html, money } from "../format.js";
import { icon } from "../icons.js";
import { navigate } from "../router.js";
import { refresh, store } from "../state.js";
import { editDelete, empty, pageHead } from "../ui.js";

export function openCardForm(card = null) {
  return new Promise((resolve) =>
    openModal({
      title: card ? "Editar cartão" : "Novo cartão",
      content: html`${fields(
        [
          { name: "name", label: "Nome", required: true, placeholder: "Nubank, Inter…" },
          { name: "brand", label: "Bandeira", placeholder: "Visa, Master…" },
          { name: "limit", label: "Limite", type: "money" },
          { name: "color", label: "Cor", type: "color", hint: "Escolha no seletor ou digite o código hex" },
          { name: "closing_day", label: "Dia de fechamento", type: "number", min: 1, max: 31, required: true },
          { name: "due_day", label: "Dia de vencimento", type: "number", min: 1, max: 31, required: true },
          { name: "active", label: "Ativo", type: "checkbox" },
        ],
        { color: "#0ea5e9", active: true, limit: 0, ...card }
      )}<p class="mt-4 hint">Compras feitas no dia do fechamento ou depois entram na fatura seguinte.</p>`,
      onSubmit: async (form) => {
        const data = readForm(form);
        data.limit = data.limit || 0;
        const saved = await api.save("cards", { ...data, id: card?.id });
        await refresh("cards");
        toast("Cartão salvo");
        resolve(saved);
      },
    })
  );
}

export async function render(container) {
  await refresh("cards");
  const cards = store.cards;
  const el = document.createElement("div");
  container.replaceChildren(el);

  el.innerHTML = html`
    ${pageHead("Cartões de crédito", html`<button class="btn btn-primary" data-new>${icon("plus")}Cartão</button>`)}
    ${cards.length ? "" : html`<div class="card">${empty("Cadastre seus cartões para controlar faturas e parcelas.", "credit-card")}</div>`}
    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      ${cards.map((c) => {
        const used = Number(c.used_limit);
        const limit = Number(c.limit);
        const p = limit ? Math.min((used / limit) * 100, 100) : 0;
        return html`<div class="group relative flex min-h-48 cursor-pointer flex-col justify-between overflow-hidden rounded-2xl p-5 text-white shadow-md transition hover:-translate-y-0.5 hover:shadow-lg ${c.active ? "" : "opacity-60"}"
            style="background:linear-gradient(135deg, ${c.color}, #0f172a)" data-id="${c.id}" data-open tabindex="0" role="link">
          <div class="flex items-start justify-between">
            <div><div class="text-lg font-semibold">${c.name}</div><div class="text-xs text-white/70">${c.brand}${c.active ? "" : " · inativo"}</div></div>
            <div class="flex rounded-lg bg-white/10 backdrop-blur [&_.btn-icon]:text-white/80 [&_.btn-icon:hover]:bg-white/20 [&_.btn-icon:hover]:text-white">${editDelete()}</div>
          </div>
          <div>
            <div class="flex justify-between text-xs text-white/80"><span>Usado ${money(used)}</span><span>Limite ${money(limit)}</span></div>
            <div class="my-2 h-1.5 overflow-hidden rounded-full bg-white/20"><div class="h-full rounded-full bg-white" style="width:${p}%"></div></div>
            <div class="text-sm font-semibold">Disponível ${money(limit - used)}</div>
          </div>
          <div class="flex items-center justify-between text-xs text-white/80">
            <span class="flex items-center gap-1">${icon("calendar", "size-3.5")}Fecha dia ${c.closing_day} · vence dia ${c.due_day}</span>
            <span>melhor dia ${c.best_purchase_day}</span>
          </div>
        </div>`;
      })}
    </div>`;

  el.querySelector("[data-new]").addEventListener("click", async () => {
    await openCardForm();
    render(container);
  });
  el.addEventListener("click", async (e) => {
    const holder = e.target.closest("[data-id]");
    if (!holder) return;
    const card = store.cards.find((c) => String(c.id) === holder.dataset.id);
    if (e.target.closest("[data-edit]")) {
      await openCardForm(card);
      render(container);
    } else if (e.target.closest("[data-del]")) {
      if (!(await confirmDialog(`Excluir o cartão ${card.name}?`, { okLabel: "Excluir" }))) return;
      try {
        await api.del(`cards/${card.id}/`);
        toast("Cartão excluído");
        render(container);
      } catch (err) {
        toast(err.status === 409 ? "Cartão possui lançamentos; desative-o em vez de excluir." : err.message, true);
      }
    } else {
      navigate(`#/cartoes/${card.id}`);
    }
  });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.matches("[data-open]")) navigate(`#/cartoes/${e.target.dataset.id}`);
  });
}
