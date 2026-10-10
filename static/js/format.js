const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const monthFmt = new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric", timeZone: "UTC" });
const monthLongFmt = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
const dateFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });

export const money = (value) => brl.format(Number(value || 0));

export function toDate(value) {
  if (!value) return null;
  const [y, m, d] = String(value).slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d || 1));
}

export const fmtDate = (value) => (value ? dateFmt.format(toDate(value)) : "—");
export const fmtMonth = (value) => (value ? monthFmt.format(toDate(value)).replace(". de ", "/").replace(" de ", "/") : "—");
export const fmtMonthLong = (value) => {
  if (!value) return "—";
  const text = monthLongFmt.format(toDate(value));
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/** 'YYYY-MM' */
export function monthKey(value) {
  if (!value) return "";
  if (value instanceof Date) return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
  return String(value).slice(0, 7);
}

export function addMonths(key, n) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export const currentMonth = () => monthKey(new Date());

export function todayISO() {
  const d = new Date();
  return `${monthKey(d)}-${String(d.getDate()).padStart(2, "0")}`;
}

export const pct = (value) => (value === null || value === undefined ? "—" : `${Number(value).toLocaleString("pt-BR")}%`);

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

/** HTML já escapado/confiável. Converte para string em innerHTML, join e concatenação. */
class SafeHtml {
  constructor(value) {
    this.__raw = String(value ?? "");
  }
  toString() {
    return this.__raw;
  }
}

export const raw = (value) => (value instanceof SafeHtml ? value : new SafeHtml(value));

const render = (value) => {
  if (value instanceof SafeHtml) return value.__raw;
  if (Array.isArray(value)) return value.map(render).join("");
  return esc(value);
};

/** Template tag que escapa interpolações; aceita html`` aninhado, arrays e raw(). */
export function html(strings, ...values) {
  return new SafeHtml(strings.reduce((out, str, i) => out + render(values[i - 1]) + str));
}

export function progressClass(value) {
  if (value === null || value === undefined) return "";
  if (value > 100) return "danger";
  if (value >= 85) return "warn";
  return "";
}

export const signClass = (value) => (Number(value) < 0 ? "neg" : "pos");

export const isDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;
