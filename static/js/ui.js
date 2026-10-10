import { fmtMonthLong, html, money, pct, progressClass } from "./format.js";
import { icon } from "./icons.js";

export const pageHead = (title, actions = "") =>
  html`<div class="page-head"><h1 class="page-title">${title}</h1><div class="flex flex-wrap items-center gap-2">${actions}</div></div>`;

export const monthNav = (month) => html`
  <div class="inline-flex h-10 items-center rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-700 dark:bg-slate-900" data-monthnav>
    <button type="button" class="btn-icon" data-step="-1" aria-label="Mês anterior">${icon("chevron-left")}</button>
    <span class="min-w-32 text-center text-sm font-semibold" data-month-label>${fmtMonthLong(`${month}-01`)}</span>
    <button type="button" class="btn-icon" data-step="1" aria-label="Próximo mês">${icon("chevron-right")}</button>
  </div>`;

export const kpi = (label, value, { iconName, sub = "", cls = "" } = {}) => html`
  <div class="card">
    <div class="kpi-label">${iconName ? icon(iconName, "size-3.5") : ""}${label}</div>
    <div class="kpi-value ${cls}">${value}</div>
    ${sub ? html`<div class="mt-0.5 text-xs muted">${sub}</div>` : ""}
  </div>`;

export const progress = (value) =>
  html`<div class="progress ${progressClass(value)}"><div style="width:${Math.min(Math.max(value || 0, 0), 100)}%"></div></div>`;

export const empty = (text, iconName = "inbox") =>
  html`<div class="empty">${icon(iconName, "size-8 text-slate-300 dark:text-slate-600")}<span>${text}</span></div>`;

export const iconButton = (name, iconName, title, cls = "") =>
  html`<button type="button" class="btn-icon ${cls}" data-${name} title="${title}" aria-label="${title}">${icon(iconName)}</button>`;

export const editDelete = () => html`${iconButton("edit", "pencil", "Editar")}${iconButton("del", "trash-2", "Excluir", "hover:!text-rose-600")}`;

export const statusBadge = (paid) =>
  paid ? html`<span class="badge badge-ok">${icon("check", "size-3")}Pago</span>` : html`<span class="badge badge-warn">${icon("clock", "size-3")}Pendente</span>`;

export const blockUsage = (b) => html`
  ${progress(b.pct)}
  <div class="mt-1 text-xs muted">${pct(b.pct)} de ${money(b.budget)}</div>`;
