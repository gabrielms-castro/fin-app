import { esc, html, raw } from "../format.js";

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** '#abc' | 'abc' | '#aabbcc' -> '#aabbcc' (ou null se inválido). */
export function normalizeHex(value) {
  const match = String(value || "").trim().match(HEX);
  if (!match) return null;
  const hex = match[1].length === 3 ? [...match[1]].map((c) => c + c).join("") : match[1];
  return `#${hex.toLowerCase()}`;
}

// Mantém o seletor de cor e o campo hex sincronizados.
document.addEventListener("input", (e) => {
  const box = e.target.closest(".color-field");
  if (!box) return;
  const picker = box.querySelector('input[type="color"]');
  const text = box.querySelector('input[type="text"]');
  if (e.target === picker) {
    text.value = picker.value;
    text.setCustomValidity("");
    text.classList.remove("input-error");
  } else {
    const hex = normalizeHex(text.value);
    if (hex) picker.value = hex;
    text.setCustomValidity(hex ? "" : "Use o formato #RRGGBB ou #RGB");
    text.classList.toggle("input-error", !hex);
  }
});

const moneyFmt = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Valor (número ou string "1234.5") -> "1.234,50" para exibir no campo de dinheiro. */
export function formatMoneyInput(value) {
  if (value === null || value === undefined || value === "") return "";
  const number = Number(value);
  return Number.isFinite(number) ? moneyFmt.format(number) : "";
}

/** "1.234,50" -> "1234.50" (ou null se vazio). */
export function parseMoneyInput(text) {
  const digits = String(text || "").replace(/\D/g, "");
  if (!digits) return null;
  const cents = BigInt(digits);
  const sign = String(text).includes("-") && cents > 0n ? "-" : "";
  return `${sign}${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

// Campo de dinheiro estilo caixa eletrônico: os dígitos entram pelos centavos
// (1 -> 0,01; 100 -> 1,00; 4590 -> 45,90), sem precisar digitar a vírgula.
document.addEventListener("input", (e) => {
  const input = e.target;
  if (!input.matches?.("input[data-money]")) return;
  let value = parseMoneyInput(input.value);
  if (value && input.dataset.money !== "signed") value = value.replace("-", "");
  const negative = input.dataset.money === "signed" && input.value.includes("-");
  input.value = value ? formatMoneyInput(value) : negative ? "-" : "";
  input.setSelectionRange?.(input.value.length, input.value.length);
});

// Teclado numérico do celular não tem "-": o botão ± inverte o sinal.
document.addEventListener("click", (e) => {
  const button = e.target.closest("[data-money-sign]");
  if (!button) return;
  const input = button.parentElement.querySelector("input[data-money]");
  input.value = input.value.startsWith("-") ? input.value.slice(1) : `-${input.value}`;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.focus();
});

/**
 * Renderiza campos a partir de especificações:
 * { name, label, type: text|number|money|date|month|select|textarea|checkbox|seg|color,
 *   options:[{value,label}], required, full, step, min, max, placeholder, hint, empty, list,
 *   signed (money: aceita "-" para valor negativo) }
 */
export function fields(specs, values = {}) {
  return html`<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">${specs.map((spec) => field(spec, values[spec.name]))}</div>`;
}

export function field(spec, value) {
  const { name, label, type = "text", required, full, options = [], hint } = spec;
  const span = full || type === "textarea" || type === "seg" ? "sm:col-span-2" : "";
  const req = required ? "required" : "";
  const val = value ?? spec.default ?? "";
  let control;
  if (type === "select") {
    const emptyOpt = spec.empty !== undefined ? `<option value="">${esc(spec.empty)}</option>` : "";
    control = `<select class="input" name="${name}" ${req}>${emptyOpt}${options
      .map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(val) ? "selected" : ""}>${esc(o.label)}</option>`)
      .join("")}</select>`;
  } else if (type === "seg") {
    control = `<div class="seg-group" role="radiogroup">${options
      .map(
        (o) =>
          `<label class="pill"><input type="radio" name="${name}" value="${esc(o.value)}" ${String(o.value) === String(val) ? "checked" : ""} ${req}><span>${esc(o.label)}</span></label>`
      )
      .join("")}</div>`;
  } else if (type === "textarea") {
    control = `<textarea class="input" name="${name}" rows="2" ${req}>${esc(val)}</textarea>`;
  } else if (type === "checkbox") {
    return html`<label class="check ${span}" data-field="${name}"><input type="checkbox" name="${name}" ${val ? "checked" : ""}>${label}</label>`;
  } else if (type === "color") {
    const hex = normalizeHex(val) || "#000000";
    control = `<div class="color-field flex gap-2">
      <input type="color" value="${hex}" aria-label="Seletor de cor" class="input w-14 shrink-0 cursor-pointer p-1">
      <input type="text" class="input font-mono lowercase" name="${name}" value="${esc(val || hex)}" maxlength="7" placeholder="#RRGGBB"
        pattern="#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})" autocapitalize="off" spellcheck="false" ${req}>
    </div>`;
  } else {
    const attrs = [];
    let inputType = type;
    if (type === "money") {
      inputType = "text";
      attrs.push(`data-money="${spec.signed ? "signed" : ""}"`, 'inputmode="numeric"', 'autocomplete="off"');
      if (!spec.placeholder) attrs.push('placeholder="0,00"');
    }
    if (type === "number") attrs.push('inputmode="numeric"');
    const passthrough = type === "money" ? ["placeholder", "list"] : ["step", "min", "max", "placeholder", "list"];
    passthrough.forEach((a) => spec[a] !== undefined && attrs.push(`${a}="${esc(spec[a])}"`));
    const v = type === "month" && val ? String(val).slice(0, 7) : type === "money" ? formatMoneyInput(val) : val;
    control = `<input class="input" type="${inputType}" name="${name}" value="${esc(v)}" ${req} ${attrs.join(" ")}>`;
    if (type === "money" && spec.signed) {
      control = `<div class="flex gap-2">${control}<button type="button" class="btn w-12 shrink-0 justify-center" data-money-sign aria-label="Inverter sinal">±</button></div>`;
    }
  }
  return html`<label class="field ${span}" data-field="${name}">${label}${raw(control)}${hint ? html`<span class="hint">${hint}</span>` : ""}</label>`;
}

/** Lê os valores do form convertendo tipos: booleanos, vazios -> null, month -> YYYY-MM-01, cor -> #rrggbb. */
export function readForm(form) {
  const data = {};
  form.querySelectorAll("input[name], select[name], textarea[name]").forEach((el) => {
    if (el.closest("[hidden]")) return;
    if (el.type === "radio") {
      if (el.checked) data[el.name] = el.value;
      return;
    }
    if (el.type === "checkbox") {
      data[el.name] = el.checked;
      return;
    }
    let value = el.value.trim();
    if (value === "") value = null;
    else if (el.type === "month") value = `${value}-01`;
    else if (el.matches("[data-money]")) value = parseMoneyInput(value);
    else if (el.closest(".color-field")) value = normalizeHex(value) || value;
    data[el.name] = value;
  });
  return data;
}

export const options = (items, labelKey = "name", valueKey = "id") =>
  items.map((i) => ({ value: i[valueKey], label: typeof labelKey === "function" ? labelKey(i) : i[labelKey] }));

const autoBox = (label, attr, content) => html`
  <div class="field">${label}
    <div class="input flex cursor-default items-center gap-2 bg-slate-50 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300" ${raw(attr)} aria-live="polite">${content}</div>
  </div>`;

const blockContent = (c) => (c ? html`<span class="dot" style="background:${c.block_color || "#94a3b8"}"></span>${c.block_name}` : html`<span class="muted">—</span>`);
const natureContent = (c) => (c ? html`${c.nature_name}` : html`<span class="muted">—</span>`);

/**
 * Grupo de gasto que só aparece quando há escolha: com um único grupo possível
 * (ex.: dívidas), vira um campo oculto já preenchido.
 */
export function categoryField(name, categories, value, opts) {
  if (categories.length === 1) return html`<input type="hidden" name="${name}" value="${categories[0].id}">`;
  return categorySelect(name, categories, value, opts);
}

/**
 * Seletor de grupo de gasto. Natureza e bloco não são escolhidos: são exibidos
 * automaticamente a partir do grupo (a configuração do grupo define ambos).
 */
export function categorySelect(name, categories, value, { required = true, label = "Grupo de gasto", empty = "Selecione…" } = {}) {
  const selected = categories.find((c) => String(c.id) === String(value));
  const opts = [...categories]
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
    .map(
      (c) =>
        `<option value="${c.id}" data-nature="${esc(c.nature_name)}" data-block="${esc(c.block_name)}" data-block-color="${esc(c.block_color || "")}" data-description="${esc(c.description)}" ${c === selected ? "selected" : ""}>${esc(c.name)}</option>`
    )
    .join("");
  return html`<div class="grid grid-cols-2 gap-x-4 gap-y-2 sm:col-span-2" data-category-field>
    <label class="field col-span-2" data-field="${name}">${label}
      <select class="input" name="${name}" ${required ? "required" : ""}><option value="">${empty}</option>${raw(opts)}</select>
      <span class="hint" data-category-description>${selected?.description || ""}</span>
    </label>
    ${autoBox(html`<span class="flex items-center gap-1">Natureza <span class="badge !py-0 text-[10px]">automático</span></span>`, "data-auto-nature", natureContent(selected))}
    ${autoBox(html`<span class="flex items-center gap-1">Bloco <span class="badge !py-0 text-[10px]">automático</span></span>`, "data-auto-block", blockContent(selected))}
  </div>`;
}

// Atualiza natureza e bloco quando o grupo muda.
document.addEventListener("change", (e) => {
  const box = e.target.closest("[data-category-field]");
  if (!box || e.target.tagName !== "SELECT") return;
  const opt = e.target.selectedOptions[0];
  const c = opt?.value
    ? { nature_name: opt.dataset.nature, block_name: opt.dataset.block, block_color: opt.dataset.blockColor }
    : null;
  box.querySelector("[data-auto-nature]").innerHTML = natureContent(c);
  box.querySelector("[data-auto-block]").innerHTML = blockContent(c);
  box.querySelector("[data-category-description]").textContent = opt?.dataset.description || "";
});
