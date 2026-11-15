import { api } from "../api.js";
import { categorySelect, fields, options, readForm } from "../components/form.js";
import { confirmDialog, openModal, toast } from "../components/modal.js";
import { currentMonth, fmtDate, fmtMonth, html, money, pct, todayISO } from "../format.js";
import { icon } from "../icons.js";
import { activeCategories } from "../state.js";
import { empty, iconButton, pageHead } from "../ui.js";

const KIND_LABEL = { aporte: "Aporte", retirada: "Retirada" };

/** Aporte (precisa de saldo livre e vira gasto do mês) ou retirada (volta para o saldo livre). */
async function moveForm(goal, kind, onSaved) {
  const deposit = kind === "aporte";
  const fb = deposit ? await api.get("free-balance/", { month: currentMonth() }) : null;
  const available = deposit ? Number(fb.available) : Number(goal.saved);
  const info = deposit
    ? available > 0
      ? html`<div class="flex items-start gap-2 rounded-xl bg-indigo-50 px-3 py-2.5 text-sm text-indigo-800 dark:bg-indigo-500/10 dark:text-indigo-200">${icon("wallet", "size-4 mt-0.5")}<span>
          Saldo livre disponível: <b class="num">${money(available)}</b>. O aporte conta como gasto do mês${
            goal.investment_name ? html` (aporte em <b>${goal.investment_name}</b>)` : goal.category_name ? html` no grupo <b>${goal.category_name}</b>` : ""}.</span></div>`
      : html`<div class="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200" role="status">${icon("triangle-alert", "size-4 mt-0.5")}<span>
          Sem saldo livre para aportar (disponível ${money(available)}). O aporte usa o dinheiro que sobrou do que você recebeu:
          <a href="#/receitas" class="font-medium underline" data-close>lance seus recebimentos em Receitas</a>.</span></div>`
    : html`<div class="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-sm dark:bg-slate-800/60">${icon("piggy-bank", "size-4 mt-0.5")}<span>
        Guardado na meta: <b class="num">${money(goal.saved)}</b>. O valor retirado volta para o saldo livre.</span></div>`;
  openModal({
    title: `${deposit ? "Aportar em" : "Retirar de"} ${goal.name}`,
    submitLabel: deposit ? "Aportar" : "Retirar",
    content: html`<div class="space-y-4">${info}${fields(
      [
        { name: "amount", label: "Valor", type: "money", required: true, hint: available > 0 ? `Máximo: ${money(available)}` : "" },
        { name: "date", label: "Data", type: "date", required: true },
        { name: "notes", label: "Observação", full: true },
      ],
      { date: todayISO() }
    )}</div>`,
    onSubmit: async (form) => {
      const data = readForm(form);
      await api.post(`goals/${goal.id}/move/`, { ...data, kind });
      toast(`${deposit ? "Aporte" : "Retirada"} de ${money(data.amount)} ${deposit ? "registrado" : "registrada"} em "${goal.name}"`);
      onSaved();
    },
  });
}

/**
 * Histórico da meta (metas sem investimento vinculado): aportes e retiradas feitos na meta,
 * sobras do mês destinadas pelo dashboard e, por último, o "já guardado" ao criar a meta
 * (não é um aporte: não vira lançamento e é ajustado em Editar meta).
 */
async function drawHistory(box, goal, onChange) {
  const [movements, allocations] = await Promise.all([
    api.get("goal-movements/", { goal: goal.id }),
    api.get("surplus-allocations/", { goal: goal.id }),
  ]);
  const entries = [
    ...movements.map((m) => ({
      type: "movement", id: m.id, kind: m.kind, date: m.date, amount: m.amount, created: m.created_at,
      label: KIND_LABEL[m.kind], sub: m.notes,
    })),
    // Com aporte em investimento (movement), a sobra conta no investimento, não na meta.
    ...allocations.filter((a) => !a.movement).map((a) => ({
      type: "allocation", id: a.id, kind: "aporte", date: a.created_at.slice(0, 10), amount: a.amount, created: a.created_at,
      label: "Sobra destinada", sub: [`sobra de ${fmtMonth(a.competence)}`, a.notes].filter(Boolean).join(" · "),
    })),
  ].sort((x, y) => y.date.localeCompare(x.date) || y.created.localeCompare(x.created));

  const initial = Number(goal.initial_amount) > 0
    ? html`<div class="flex items-center gap-2 py-2 text-sm" data-initial>
        <span class="muted">${icon("flag", "size-4")}</span>
        <div class="min-w-0 flex-1"><div class="font-medium">Valor inicial</div>
          <div class="text-xs muted">${fmtDate(goal.created_at.slice(0, 10))} · já guardado ao criar a meta</div></div>
        <span class="num font-medium">${money(goal.initial_amount)}</span>
        ${iconButton("edit", "pencil", "Editar valor inicial")}
      </div>`
    : "";
  box.innerHTML = entries.length || initial
    ? html`<div class="list">${entries.map(
        (m) => html`<div class="flex items-center gap-2 py-2 text-sm" data-entry="${m.type}:${m.id}">
          <span class="${m.kind === "aporte" ? "pos" : "neg"}">${icon(
            m.type === "allocation" ? "piggy-bank" : m.kind === "aporte" ? "arrow-down-left" : "arrow-up-right", "size-4")}</span>
          <div class="min-w-0 flex-1"><div class="font-medium">${m.label}</div>
            <div class="text-xs muted">${fmtDate(m.date)}${m.sub ? ` · ${m.sub}` : ""}</div></div>
          <span class="num font-medium ${m.kind === "aporte" ? "" : "neg"}">${m.kind === "aporte" ? "" : "− "}${money(m.amount)}</span>
          ${iconButton("undo-entry", "trash-2", m.type === "allocation" ? "Desfazer destinação" : "Excluir movimentação", "hover:!text-rose-600")}
        </div>`
      )}${initial}</div>`
    : html`<p class="py-2 text-sm muted">Nenhum aporte ou retirada ainda.</p>`;
  box.querySelectorAll("[data-undo-entry]").forEach((btn) =>
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const [type, id] = btn.closest("[data-entry]").dataset.entry.split(":");
      const allocation = type === "allocation";
      const message = allocation
        ? "Desfazer esta destinação? O valor volta para o saldo livre do mês."
        : "Excluir esta movimentação? Se for um aporte, o lançamento dele também é excluído.";
      if (!(await confirmDialog(message, { okLabel: allocation ? "Desfazer" : "Excluir" }))) return;
      await api.del(allocation ? `surplus-allocations/${id}/` : `goal-movements/${id}/`);
      toast(allocation ? "Destinação desfeita" : "Movimentação excluída");
      onChange();
    })
  );
}

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
    ) + html`<div class="mt-4" data-goal-category>${categorySelect("category", activeCategories("investimento"), values.category ?? "", {
      required: false, label: "Grupo dos aportes (orçamento)", empty: "Padrão (1º grupo de Investimentos)",
    })}<span class="hint">Sem investimento vinculado, cada aporte vira um gasto pago neste grupo.</span></div>`,
    onOpen: (form) => {
      const sync = () => (form.querySelector("[data-goal-category]").hidden = Boolean(form.investment.value));
      form.investment.addEventListener("change", sync);
      sync();
    },
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
    ${g.active
      ? html`<div class="mt-4 flex flex-wrap gap-2">
          <button type="button" class="btn btn-sm btn-primary" data-deposit>${icon("plus", "size-3.5")}Aportar</button>
          <button type="button" class="btn btn-sm" data-withdraw ${Number(g.saved) > 0 ? "" : "disabled"}>${icon("minus", "size-3.5")}Retirar</button>
          ${g.investment
            ? html`<a href="#/investimentos" class="btn btn-sm ml-auto">${icon("history", "size-3.5")}Histórico em Investimentos</a>`
            : html`<button type="button" class="btn btn-sm ml-auto" data-history aria-expanded="false">${icon("history", "size-3.5")}Histórico</button>`}
        </div>
        <div class="mt-2 border-t border-slate-100 pt-2 dark:border-slate-800" data-history-box hidden></div>`
      : ""}
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
    if (t.closest("[data-deposit]")) return moveForm(goal, "aporte", reload);
    if (t.closest("[data-withdraw]")) return moveForm(goal, "retirada", reload);
    if (t.closest("[data-history]")) {
      const btn = t.closest("[data-history]");
      const box = card.querySelector("[data-history-box]");
      const open = box.hidden;
      box.hidden = !open;
      btn.setAttribute("aria-expanded", String(open));
      if (open) await drawHistory(box, goal, reload);
      return;
    }
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
