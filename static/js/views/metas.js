import { api } from "../api.js";
import { fields, options, readForm } from "../components/form.js";
import { confirmDialog, openModal, toast } from "../components/modal.js";
import { fmtDate, html, money, pct } from "../format.js";
import { icon } from "../icons.js";
import { empty, iconButton, pageHead } from "../ui.js";

function goalForm(goal, investments, onSaved) {
  const values = { color: "#10b981", active: true, initial_amount: 0, ...goal };
  openModal({
    title: goal ? "Editar meta" : "Nova meta",
    content: fields(
      [
        { name: "name", label: "Nome", required: true, full: true, placeholder: "Reserva de emergência, viagem, entrada do apê…" },
        { name: "target_amount", label: "Valor-alvo", type: "money", required: true },
        { name: "target_date", label: "Prazo (opcional)", type: "date", hint: "Com prazo, calculamos quanto guardar por mês" },
        {
          name: "investment", label: "Investimento vinculado", type: "select", empty: "Nenhum",
          options: options(investments.filter((i) => i.active || i.id === values.investment)),
          hint: "O saldo do investimento vira o progresso da meta",
        },
        { name: "initial_amount", label: "Já guardado", type: "money", hint: "Usado quando não há investimento vinculado" },
        { name: "color", label: "Cor", type: "color" },
        { name: "active", label: "Ativa", type: "checkbox" },
      ],
      values
    ),
    onSubmit: async (form) => {
      const data = readForm(form);
      data.initial_amount ??= 0;
      await api.save("goals", { ...data, id: goal?.id });
      toast("Meta salva");
      onSaved();
    },
  });
}

const goalCard = (g) => html`<div class="card ${g.active ? "" : "opacity-60"}" data-id="${g.id}">
    <div class="flex items-start gap-3">
      <span class="grid size-10 shrink-0 place-items-center rounded-xl text-white" style="background:${g.color}">${icon("target", "size-5")}</span>
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-2 font-semibold">${g.name}${g.active ? "" : html`<span class="badge">arquivada</span>`}${
          Number(g.remaining) === 0 ? html`<span class="badge badge-ok">${icon("check", "size-3")}atingida</span>` : ""
        }</div>
        <div class="text-xs muted">${g.target_date ? `até ${fmtDate(g.target_date)}` : "sem prazo"}${g.investment_name ? ` · ${g.investment_name}` : ""}</div>
      </div>
      <div class="-mr-2 flex">
        ${iconButton("edit", "pencil", "Editar")}
        ${g.active ? iconButton("archive", "archive", "Arquivar") : iconButton("unarchive", "archive-restore", "Reativar")}
        ${iconButton("del", "trash-2", "Excluir", "hover:!text-rose-600")}
      </div>
    </div>
    <div class="mt-4 flex items-baseline justify-between gap-2">
      <span class="num text-lg font-bold">${money(g.saved)}</span>
      <span class="num text-sm muted">de ${money(g.target_amount)} · ${pct(Math.round(g.progress_pct))}</span>
    </div>
    <div class="progress mt-2"><div style="width:${Math.min(Number(g.progress_pct), 100)}%;background:${g.color}"></div></div>
    <div class="mt-3 text-sm">${
      g.suggested_monthly === null
        ? html`<span class="muted">Faltam ${money(g.remaining)} · defina um prazo para ver o aporte mensal</span>`
        : Number(g.remaining) === 0
          ? html`<span class="pos">Meta atingida!</span>`
          : html`Guardar <b class="num">${money(g.suggested_monthly)}/mês</b> <span class="muted">por ${g.months_left} ${g.months_left === 1 ? "mês" : "meses"}</span>`
    }</div>
  </div>`;

export async function render(el, { query }) {
  const showArchived = query.archived === "1";
  const [goals, investments] = await Promise.all([api.get("goals/"), api.get("investments/")]);
  const reload = () => render(el, { query: { archived: showArchived ? "1" : "" } });
  const visible = goals.filter((g) => showArchived || g.active);
  const archived = goals.length - goals.filter((g) => g.active).length;
  const active = goals.filter((g) => g.active);
  const monthly = active.reduce((t, g) => t + Number(g.suggested_monthly || 0), 0);

  el.innerHTML = html`
    ${pageHead("Metas", html`<button class="btn btn-primary" data-new>${icon("plus")}Nova meta</button>`)}
    ${active.length
      ? html`<div class="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
          <div class="card"><div class="kpi-label">${icon("target", "size-3.5")}Metas ativas</div><div class="kpi-value">${active.length}</div></div>
          <div class="card"><div class="kpi-label">${icon("piggy-bank", "size-3.5")}Já guardado</div><div class="kpi-value">${money(active.reduce((t, g) => t + Number(g.saved), 0))}</div>
            <div class="mt-0.5 text-xs muted">de ${money(active.reduce((t, g) => t + Number(g.target_amount), 0))}</div></div>
          <div class="card col-span-2 lg:col-span-1"><div class="kpi-label">${icon("calendar-clock", "size-3.5")}Aporte sugerido</div><div class="kpi-value">${money(monthly)}<span class="text-sm font-normal muted">/mês</span></div></div>
        </div>`
      : ""}
    ${visible.length
      ? html`<div class="grid gap-4 md:grid-cols-2">${visible.map(goalCard)}</div>`
      : html`<div class="card">${empty("Nenhuma meta ainda", "target")}<div class="flex justify-center pb-4"><button class="btn btn-primary" data-new>${icon("plus")}Criar meta</button></div></div>`}
    ${archived
      ? html`<button class="btn btn-sm mt-4" data-toggle-archived>${icon(showArchived ? "eye-off" : "eye", "size-3.5")}${showArchived ? "Ocultar" : "Mostrar"} arquivadas (${archived})</button>`
      : ""}`;

  el.onclick = async (e) => {
    const t = e.target;
    if (t.closest("[data-new]")) return goalForm(null, investments, reload);
    if (t.closest("[data-toggle-archived]")) return render(el, { query: { archived: showArchived ? "" : "1" } });
    const card = t.closest("[data-id]");
    if (!card) return;
    const goal = goals.find((g) => String(g.id) === card.dataset.id);
    if (t.closest("[data-edit]")) return goalForm(goal, investments, reload);
    if (t.closest("[data-archive]")) {
      if (!(await confirmDialog(`Arquivar a meta "${goal.name}"? Ela some da lista, mas pode ser reativada.`, { okLabel: "Arquivar", danger: false }))) return;
      await api.patch(`goals/${goal.id}/`, { active: false });
      toast("Meta arquivada");
      return reload();
    }
    if (t.closest("[data-unarchive]")) {
      await api.patch(`goals/${goal.id}/`, { active: true });
      toast("Meta reativada");
      return reload();
    }
    if (t.closest("[data-del]")) {
      if (!(await confirmDialog(`Excluir a meta "${goal.name}"?`, { okLabel: "Excluir" }))) return;
      await api.del(`goals/${goal.id}/`);
      toast("Meta excluída");
      reload();
    }
  };
}
