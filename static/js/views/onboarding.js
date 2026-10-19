import { api } from "../api.js";
import { formatMoneyInput, parseMoneyInput } from "../components/form.js";
import { setButtonLoading } from "../components/loading.js";
import { toast } from "../components/modal.js";
import { currentMonth, esc, html, money, raw, todayISO } from "../format.js";
import { icon } from "../icons.js";
import { refresh, store } from "../state.js";

// Divisão Essenciais / Estilo de vida / Prioridades financeiras (na ordem dos blocos).
const PRESETS = [
  { key: "50-30-20", label: "Equilibrado", values: [50, 30, 20] },
  { key: "60-30-10", label: "Moderado", values: [60, 30, 10] },
  { key: "70-20-10", label: "Conservador", values: [70, 20, 10] },
];
const GOAL_COLORS = ["#10b981", "#6366f1", "#f59e0b", "#0ea5e9", "#ec4899", "#8b5cf6"];
const STEPS = ["Renda", "Proporções", "Parcelados", "Metas"];
const RESERVE = "Reserva de emergência";

const num = (v) => Number(v || 0);
const sumBy = (items, key) => items.reduce((t, i) => t + num(i[key]), 0);

/** Assistente de configuração inicial. Resolve quando o usuário conclui ou pula. */
export async function openOnboarding() {
  await refresh("blocks", "incomeSources");
  const [settings, goals] = await Promise.all([api.get("settings/"), api.get("goals/")]);
  const blocks = store.blocks.filter((b) => b.kind === "percent");
  const sources = store.incomeSources.filter((s) => s.active);

  const state = {
    step: 0,
    hasIncome: sources.length > 0,
    income: sumBy(sources, "amount"),
    day: 5,
    pcts: Object.fromEntries(blocks.map((b) => [b.id, num(b.value)])),
    saved: Object.fromEntries(blocks.map((b) => [b.id, num(b.value)])),
    ceiling: num(settings.installment_ceiling_pct),
    goals: null,
    existingGoals: goals.filter((g) => g.active),
    created: 0,
    committed: null,
  };

  return new Promise((resolve) => {
    const wrapper = document.createElement("div");
    wrapper.className = "motion-safe:animate-fade-in fixed inset-0 z-50 flex items-stretch justify-center bg-slate-900/60 backdrop-blur-[2px] sm:items-center sm:p-4";
    wrapper.innerHTML = html`
      <section class="motion-safe:animate-pop-in flex h-full w-full flex-col bg-white shadow-2xl sm:h-auto sm:max-h-[92vh] sm:max-w-2xl sm:rounded-2xl dark:bg-slate-900" role="dialog" aria-modal="true" aria-labelledby="onb-title">
        <header class="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div class="flex items-center justify-between gap-3">
            <h2 id="onb-title" class="flex items-center gap-2 text-base font-semibold">${icon("sparkles", "size-4 text-indigo-600 dark:text-indigo-400")}Configuração inicial</h2>
            <span class="text-xs font-medium muted" data-step-label></span>
          </div>
          <div class="mt-3 grid grid-cols-4 gap-1.5" data-dots>${STEPS.map(
            (s) => html`<div><div class="h-1.5 rounded-full bg-slate-200 transition-colors dark:bg-slate-700"></div><div class="mt-1 hidden text-[11px] muted sm:block">${s}</div></div>`
          )}</div>
        </header>
        <div class="flex-1 overflow-y-auto px-5 py-5" data-body></div>
        <footer class="flex items-center gap-2 border-t border-slate-200 px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:pb-4 dark:border-slate-800">
          <button type="button" class="btn btn-sm mr-auto border-transparent !shadow-none muted" data-skip>Pular configuração</button>
          <button type="button" class="btn" data-back>${icon("chevron-left")}Voltar</button>
          <button type="button" class="btn btn-primary" data-next></button>
        </footer>
      </section>`;
    const $ = (sel) => wrapper.querySelector(sel);
    const body = $("[data-body]");
    const next = $("[data-next]");

    const close = () => {
      wrapper.remove();
      document.body.style.overflow = "";
      resolve();
    };

    const steps = [incomeStep, proportionsStep, ceilingStep, goalsStep, summaryStep].map((f) => f(state));

    function draw() {
      const current = steps[state.step];
      const isSummary = state.step === STEPS.length;
      $("[data-step-label]").textContent = isSummary ? "Pronto!" : `Passo ${state.step + 1} de ${STEPS.length}`;
      wrapper.querySelectorAll("[data-dots] > div > div:first-child").forEach((dot, i) => {
        dot.classList.toggle("!bg-indigo-600", i <= state.step);
      });
      $("[data-skip]").hidden = isSummary;
      $("[data-back]").hidden = state.step === 0 || isSummary;
      next.innerHTML = isSummary
        ? html`Ir para o dashboard${icon("arrow-right")}`
        : state.step === STEPS.length - 1
          ? html`Concluir${icon("check")}`
          : html`Avançar${icon("chevron-right")}`;
      body.innerHTML = current.render();
      body.scrollTop = 0;
      current.bind?.(body, { setValid: (ok) => (next.disabled = !ok) });
      if (!current.bind) next.disabled = false;
      body.querySelector("input:not([type=hidden]):not([type=range])")?.focus({ preventScroll: true });
    }

    next.addEventListener("click", async () => {
      const current = steps[state.step];
      if (state.step === STEPS.length) return close();
      const invalid = [...body.querySelectorAll("input:invalid")].find((el) => !el.closest("[hidden]"));
      if (invalid) return invalid.reportValidity();
      const error = current.validate?.(body);
      if (error) return toast(error, true);
      setButtonLoading(next, true);
      try {
        await current.save?.(body);
        state.step++;
      } catch (err) {
        toast(err.message || "Não foi possível salvar", true);
      } finally {
        setButtonLoading(next, false);
      }
      draw();
    });

    $("[data-back]").addEventListener("click", () => {
      steps[state.step].collect?.(body);
      state.step--;
      draw();
    });

    $("[data-skip]").addEventListener("click", async (e) => {
      setButtonLoading(e.currentTarget, true);
      try {
        await api.post("settings/onboarding/skip/");
        toast("Tudo bem! Você pode refazer em Configurações.");
        close();
      } catch (err) {
        setButtonLoading(e.currentTarget, false);
        toast(err.message, true);
      }
    });

    document.body.style.overflow = "hidden";
    document.getElementById("modal-root").appendChild(wrapper);
    draw();
  });
}

const intro = (title, text) =>
  html`<h3 class="text-lg font-bold tracking-tight">${title}</h3><p class="mt-1 mb-5 text-sm muted">${text}</p>`;

const moneyInput = (name, value, attrs = "") =>
  raw(`<input class="input" type="text" name="${name}" data-money inputmode="numeric" autocomplete="off" placeholder="0,00" value="${esc(formatMoneyInput(value))}" ${attrs}>`);

function incomeStep(state) {
  return {
    render: () => html`${intro("Quanto você recebe por mês?", "Usamos a renda líquida para transformar os percentuais do orçamento em valores.")}
      ${state.hasIncome
        ? html`<div class="flex items-center gap-3 rounded-xl bg-emerald-50 p-4 dark:bg-emerald-500/10">
            <span class="grid size-10 place-items-center rounded-xl bg-white text-emerald-600 dark:bg-slate-900 dark:text-emerald-400">${icon("wallet", "size-5")}</span>
            <div><div class="text-xs muted">Renda mensal cadastrada</div><div class="num text-xl font-bold">${money(state.income)}</div></div>
          </div>
          <p class="mt-3 hint">Vamos usar suas fontes de receita atuais. Para alterá-las, use a aba Receitas.</p>`
        : html`<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label class="field">Renda líquida mensal${moneyInput("income", state.income || "", "required")}</label>
            <label class="field">Dia do recebimento<input class="input" type="number" name="day" min="1" max="31" inputmode="numeric" value="${state.day}" required></label>
          </div>
          <p class="mt-3 hint">Criamos uma fonte de receita "Salário" a partir deste mês. Você pode adicionar outras depois.</p>`}`,
    collect(el) {
      if (state.hasIncome) return;
      state.income = num(parseMoneyInput(el.querySelector("[name=income]").value));
      state.day = num(el.querySelector("[name=day]").value) || 5;
    },
    validate(el) {
      this.collect(el);
      if (state.income <= 0) return "Informe uma renda maior que zero.";
    },
    async save() {
      if (state.hasIncome) return;
      await api.post("income-sources/", {
        name: "Salário", amount: state.income.toFixed(2), day: state.day, start_month: `${currentMonth()}-01`, active: true,
      });
      await refresh("incomeSources");
      state.hasIncome = true;
    },
  };
}

function proportionsStep(state) {
  const blocks = () => store.blocks.filter((b) => b.kind === "percent");
  const presetFor = () => PRESETS.find((p) => blocks().every((b, i) => state.pcts[b.id] === p.values[i]))?.key || "custom";
  const total = () => blocks().reduce((t, b) => t + num(state.pcts[b.id]), 0);
  const stacked = (values) =>
    html`<div class="flex h-2 overflow-hidden rounded-full">${blocks().map(
      (b, i) => html`<div style="width:${values[i]}%;background:${b.color}"></div>`
    )}</div>`;

  return {
    render: () => {
      const list = blocks();
      if (!list.length)
        return html`${intro("Proporções de gasto", "Seus blocos usam valores fixos. Ajuste-os em Configurações quando quiser.")}`;
      const usePresets = list.length === 3;
      const current = presetFor();
      return html`${intro("Como dividir sua renda?", "Escolha um modelo e ajuste se quiser. A soma dos blocos precisa dar 100%.")}
        ${usePresets
          ? html`<div class="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup">
              ${PRESETS.map(
                (p) => html`<label class="relative cursor-pointer">
                  <input type="radio" name="preset" value="${p.key}" class="peer sr-only" ${current === p.key ? "checked" : ""}>
                  <div class="h-full rounded-xl border border-slate-200 p-3 transition peer-checked:border-indigo-600 peer-checked:ring-4 peer-checked:ring-indigo-500/15 peer-focus-visible:ring-4 peer-focus-visible:ring-indigo-500/25 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/50">
                    <div class="text-sm font-semibold">${p.label}</div>
                    <div class="num mb-2 text-xs muted">${p.values.join("/")}</div>
                    ${stacked(p.values)}
                  </div>
                </label>`
              )}
              <label class="relative cursor-pointer">
                <input type="radio" name="preset" value="custom" class="peer sr-only" ${current === "custom" ? "checked" : ""}>
                <div class="h-full rounded-xl border border-dashed border-slate-300 p-3 transition peer-checked:border-indigo-600 peer-checked:ring-4 peer-checked:ring-indigo-500/15 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/50">
                  <div class="text-sm font-semibold">Personalizado</div>
                  <div class="text-xs muted">do seu jeito</div>
                </div>
              </label>
            </div>`
          : ""}
        <div class="space-y-3">${list.map(
          (b) => html`<div class="flex items-center gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <span class="dot" style="background:${b.color}"></span>
            <div class="min-w-0 flex-1"><div class="truncate text-sm font-medium">${b.name}</div><div class="num text-xs muted" data-block-money="${b.id}"></div></div>
            <div class="relative w-24"><input class="input pr-7 text-right" type="number" min="0" max="100" step="1" inputmode="numeric" data-block-pct="${b.id}" value="${state.pcts[b.id]}" aria-label="% de ${b.name}"><span class="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm muted">%</span></div>
          </div>`
        )}</div>
        <div class="mt-3 flex items-center justify-between text-sm"><span class="muted">Total</span><span class="num font-semibold" data-sum></span></div>`;
    },
    bind(el, { setValid }) {
      const list = blocks();
      if (!list.length) return setValid(true);
      const update = () => {
        list.forEach((b) => {
          el.querySelector(`[data-block-money="${b.id}"]`).textContent = `${money((state.income * num(state.pcts[b.id])) / 100)}/mês`;
        });
        const sum = Math.round(total() * 100) / 100;
        const box = el.querySelector("[data-sum]");
        box.textContent = sum === 100 ? `${sum}% ✓` : `${sum.toLocaleString("pt-BR")}% (faltam ${(100 - sum).toLocaleString("pt-BR")}%)`;
        box.className = `num font-semibold ${sum === 100 ? "pos" : "neg"}`;
        setValid(sum === 100);
      };
      el.addEventListener("change", (e) => {
        if (e.target.name !== "preset" || e.target.value === "custom") return;
        const preset = PRESETS.find((p) => p.key === e.target.value);
        list.forEach((b, i) => {
          state.pcts[b.id] = preset.values[i];
          el.querySelector(`[data-block-pct="${b.id}"]`).value = preset.values[i];
        });
        update();
      });
      el.addEventListener("input", (e) => {
        const id = e.target.dataset.blockPct;
        if (!id) return;
        state.pcts[id] = num(e.target.value);
        const radio = el.querySelector(`[name=preset][value="${presetFor()}"]`);
        if (radio) radio.checked = true;
        update();
      });
      update();
    },
    async save() {
      const changed = blocks().filter((b) => state.pcts[b.id] !== state.saved[b.id]);
      await Promise.all(changed.map((b) => api.patch(`blocks/${b.id}/`, { value: state.pcts[b.id] })));
      changed.forEach((b) => (state.saved[b.id] = state.pcts[b.id]));
      if (changed.length) await refresh("blocks");
    },
  };
}

function ceilingStep(state) {
  const limit = () => (state.income * state.ceiling) / 100;
  return {
    render: () => html`${intro("Quanto da renda pode ir para parcelas?", "Somamos as parcelas de compras parceladas (2x ou mais) de cada mês, em qualquer forma de pagamento. Acima do teto, o app avisa no dashboard e ao lançar.")}
      <div class="flex items-center gap-4">
        <input type="range" min="0" max="100" step="1" value="${state.ceiling}" class="h-2 flex-1 cursor-pointer accent-indigo-600" data-range aria-label="Teto de parcelados">
        <div class="relative w-24"><input class="input pr-7 text-right" type="number" min="0" max="100" step="1" inputmode="numeric" value="${state.ceiling}" data-number aria-label="Teto em %" required><span class="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm muted">%</span></div>
      </div>
      <div class="mt-5 rounded-xl bg-indigo-50 p-4 text-indigo-900 dark:bg-indigo-500/10 dark:text-indigo-100">
        <div class="text-sm">Até <b class="num" data-limit></b> por mês em parcelas</div>
        <div class="mt-1 text-xs opacity-80">Recomendação comum: até 30% da renda.</div>
      </div>
      <p class="mt-3 text-sm muted" data-current></p>`,
    bind(el, { setValid }) {
      const range = el.querySelector("[data-range]");
      const number = el.querySelector("[data-number]");
      const update = () => {
        el.querySelector("[data-limit]").textContent = money(limit());
        setValid(number.checkValidity());
      };
      range.addEventListener("input", () => {
        number.value = range.value;
        state.ceiling = num(range.value);
        update();
      });
      number.addEventListener("input", () => {
        state.ceiling = num(number.value);
        range.value = state.ceiling;
        update();
      });
      update();
      const showCurrent = () => {
        if (!state.committed) return;
        el.querySelector("[data-current]").innerHTML = html`${icon("info", "inline size-4 -mt-0.5")} Neste mês você já tem <b class="num">${money(state.committed)}</b> em parcelas (${Math.round((state.committed / state.income) * 100)}% da renda).`;
      };
      if (state.committed === null)
        api.get("dashboard/", { month: currentMonth() }).then((s) => {
          state.committed = num(s.installments_commitment.committed);
          if (el.isConnected) showCurrent();
        }).catch(() => {});
      else showCurrent();
    },
    validate() {
      if (state.ceiling < 0 || state.ceiling > 100) return "O teto deve ficar entre 0% e 100%.";
    },
    save: () => api.patch("settings/", { installment_ceiling_pct: state.ceiling }),
  };
}

function goalsStep(state) {
  const init = () => {
    if (state.goals) return;
    const hasReserve = state.existingGoals.some((g) => g.name.toLowerCase() === RESERVE.toLowerCase());
    const essentials = store.blocks.find((b) => b.name === "Essenciais") || store.blocks[0];
    const monthly = essentials ? (essentials.kind === "percent" ? (state.income * num(essentials.value)) / 100 : num(essentials.value)) : 0;
    state.goals = hasReserve || !monthly ? [] : [{ name: RESERVE, target: (monthly * 6).toFixed(2), date: "" }];
  };
  const row = (g, i) => html`<div class="grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-xl border border-slate-200 p-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] dark:border-slate-700" data-goal="${i}">
      <label class="field col-span-1">Nome<input class="input" name="name" value="${g.name}" maxlength="80" placeholder="Viagem, carro…" required></label>
      <button type="button" class="btn-icon self-end sm:order-last" data-remove="${i}" title="Remover" aria-label="Remover meta">${icon("trash-2")}</button>
      <label class="field">Valor-alvo${moneyInput("target", g.target, "required")}</label>
      <label class="field">Prazo (opcional)<input class="input" type="date" name="date" value="${g.date}" min="${todayISO()}"></label>
    </div>`;

  return {
    render: () => {
      init();
      return html`${intro("Quais são suas metas?", "Defina o valor-alvo e, se quiser, um prazo: calculamos quanto guardar por mês. Este passo é opcional.")}
        ${state.existingGoals.length ? html`<p class="mb-3 text-sm muted">Você já tem ${state.existingGoals.length} meta(s) ativa(s). As novas serão adicionadas a elas.</p>` : ""}
        <div class="space-y-3" data-goals>${state.goals.map(row)}</div>
        ${state.goals.length ? "" : html`<div class="rounded-xl border border-dashed border-slate-300 p-4 text-center text-sm muted dark:border-slate-700">Nenhuma meta por enquanto.</div>`}
        <button type="button" class="btn btn-sm mt-3" data-add>${icon("plus", "size-3.5")}Adicionar meta</button>
        ${state.goals.some((g) => g.name === RESERVE) ? html`<p class="mt-3 hint">Sugestão: reserva de emergência = 6 meses do bloco Essenciais.</p>` : ""}`;
    },
    collect(el) {
      el.querySelectorAll("[data-goal]").forEach((box) => {
        const g = state.goals[box.dataset.goal];
        g.name = box.querySelector("[name=name]").value.trim();
        g.target = parseMoneyInput(box.querySelector("[name=target]").value) || "";
        g.date = box.querySelector("[name=date]").value;
      });
    },
    bind(el, { setValid }) {
      setValid(true);
      const redraw = () => {
        el.innerHTML = this.render();
        this.bind(el, { setValid });
      };
      el.querySelector("[data-add]").addEventListener("click", () => {
        this.collect(el);
        state.goals.push({ name: "", target: "", date: "" });
        redraw();
        el.querySelector(`[data-goal="${state.goals.length - 1}"] [name=name]`)?.focus();
      });
      el.querySelectorAll("[data-remove]").forEach((btn) =>
        btn.addEventListener("click", () => {
          this.collect(el);
          state.goals.splice(Number(btn.dataset.remove), 1);
          redraw();
        })
      );
    },
    validate(el) {
      this.collect(el);
      if (state.goals.some((g) => num(g.target) <= 0)) return "Informe um valor-alvo maior que zero para cada meta.";
    },
    async save() {
      // Remove da lista cada meta criada: se uma falhar, as anteriores não duplicam.
      while (state.goals.length) {
        const g = state.goals[0];
        await api.post("goals/", {
          name: g.name, target_amount: g.target, target_date: g.date || null,
          color: GOAL_COLORS[(state.existingGoals.length + state.created) % GOAL_COLORS.length],
        });
        state.goals.shift();
        state.created++;
      }
      await api.post("settings/onboarding/complete/");
      store.meta.onboarding_pending = false;
    },
  };
}

function summaryStep(state) {
  const item = (iconName, label, value) => html`<div class="flex items-center gap-3 py-3">
      <span class="grid size-9 place-items-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">${icon(iconName)}</span>
      <span class="flex-1 text-sm muted">${label}</span><span class="text-right text-sm font-semibold">${value}</span>
    </div>`;
  return {
    render: () => {
      const blocks = store.blocks.filter((b) => b.kind === "percent");
      const goals = state.existingGoals.length + state.created;
      return html`<div class="mb-4 text-center">
          <span class="mx-auto grid size-12 place-items-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">${icon("check", "size-6")}</span>
          <h3 class="mt-3 text-lg font-bold tracking-tight">Tudo pronto!</h3>
          <p class="mt-1 text-sm muted">Você pode mudar isso a qualquer momento em Configurações.</p>
        </div>
        <div class="list">
          ${item("wallet", "Renda mensal", money(state.income))}
          ${blocks.length ? item("chart-pie", "Proporções", blocks.map((b) => `${b.name} ${num(b.value)}%`).join(" · ")) : ""}
          ${item("credit-card", "Teto de parcelados", `${state.ceiling}% · ${money((state.income * state.ceiling) / 100)}/mês`)}
          ${item("target", "Metas", goals ? `${goals} meta(s)` : "nenhuma")}
        </div>`;
    },
  };
}
