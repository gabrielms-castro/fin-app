import { html, raw } from "../format.js";

// Barra no topo enquanto houver requisições em andamento. Só aparece após um
// pequeno atraso para não piscar em respostas rápidas.
let pending = 0;
let showTimer;

export function trackRequest(promise) {
  pending++;
  if (pending === 1) showTimer = setTimeout(() => (document.getElementById("loading-bar").hidden = false), 150);
  return promise.finally(() => {
    if (--pending > 0) return;
    clearTimeout(showTimer);
    document.getElementById("loading-bar").hidden = true;
  });
}

export const spinner = (cls = "") => raw(`<span class="spinner ${cls}" aria-hidden="true"></span>`);

/** Troca o conteúdo do botão por um spinner (mantendo a largura) enquanto `on`. */
export function setButtonLoading(button, on) {
  if (!button) return;
  button.disabled = on;
  button.setAttribute("aria-busy", on);
  if (on) {
    button.dataset.label = button.innerHTML;
    button.style.minWidth = `${button.offsetWidth}px`;
    button.innerHTML = spinner();
  } else if (button.dataset.label !== undefined) {
    button.innerHTML = button.dataset.label;
    button.style.minWidth = "";
    delete button.dataset.label;
  }
}

const bar = (cls) => html`<div class="skeleton ${cls}"></div>`;

/** Linhas de lista "fantasmas" enquanto os dados chegam. */
export const skeletonRows = (count = 5) =>
  html`<div class="list" aria-hidden="true">${Array.from(
    { length: count },
    () => html`<div class="list-row">
      ${bar("size-10 shrink-0 rounded-xl")}
      <div class="flex-1 space-y-2">${bar("h-3.5 w-2/5")}${bar("h-3 w-3/5")}</div>
      ${bar("h-4 w-20")}
    </div>`
  )}</div>`;

/** Esqueleto genérico de página: título, KPIs e um card de lista. */
export const skeletonPage = () => html`
  <div role="status" aria-label="Carregando">
    <div class="page-head">${bar("h-7 w-44")}${bar("h-10 w-28 rounded-xl")}</div>
    <div class="stack">
      <div class="grid grid-cols-2 gap-4 lg:grid-cols-4">${Array.from(
        { length: 4 },
        () => html`<div class="card space-y-2">${bar("h-3 w-1/2")}${bar("h-6 w-3/4")}</div>`
      )}</div>
      <div class="card">${skeletonRows()}</div>
    </div>
  </div>`;
