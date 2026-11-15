import { html, raw } from "../format.js";
import { icon } from "../icons.js";
import { setButtonLoading } from "./loading.js";

const root = () => document.getElementById("modal-root");

/**
 * Abre um modal. `content` é HTML; `onSubmit(form)` pode lançar erro para manter aberto.
 * `footerStart` é HTML extra no início do rodapé (ex.: botão Excluir à esquerda).
 * `secondaryLabel` adiciona um segundo botão de envio; `onSubmit(form, { action })` recebe
 * action "secondary" quando ele é usado. `onClose()` roda sempre que o modal fecha.
 * Retorna { el, close }.
 */
export function openModal({ title, content, submitLabel = "Salvar", onSubmit, onOpen, onClose, danger = false, footerStart = "", cancelLabel = "Cancelar", secondaryLabel = "" }) {
  // O botão principal vem antes do secundário no DOM (Enter num campo aciona o 1º botão de
  // envio) e vai para o fim do rodapé com order-last.
  const wrapper = document.createElement("div");
  wrapper.className = "motion-safe:animate-fade-in fixed inset-0 z-50 flex items-stretch justify-center bg-slate-900/50 backdrop-blur-[2px] sm:items-center sm:p-4";
  wrapper.innerHTML = html`
    <form class="motion-safe:animate-pop-in flex h-full w-full flex-col bg-white shadow-2xl sm:h-auto sm:max-h-[90vh] sm:max-w-xl sm:rounded-2xl dark:bg-slate-900" role="dialog" aria-modal="true" aria-label="${title}" novalidate>
      <header class="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <h2 class="text-base font-semibold">${title}</h2>
        <button type="button" class="btn-icon" data-close aria-label="Fechar">${icon("x", "size-5")}</button>
      </header>
      <div class="flex-1 overflow-y-auto px-5 py-5">${raw(content)}</div>
      <footer class="flex gap-2 border-t border-slate-200 px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:justify-end sm:pb-4 dark:border-slate-800">
        ${footerStart ? html`<div class="flex flex-1 gap-2 sm:mr-auto sm:flex-none">${raw(footerStart)}</div>` : ""}
        <button type="button" class="btn flex-1 sm:flex-none" data-close>${cancelLabel}</button>
        ${onSubmit ? html`<button class="btn ${danger ? "btn-danger" : "btn-primary"} order-last flex-1 sm:flex-none" type="submit" data-action="primary">${submitLabel}</button>` : ""}
        ${onSubmit && secondaryLabel ? html`<button class="btn flex-1 sm:flex-none" type="submit" data-action="secondary">${secondaryLabel}</button>` : ""}
      </footer>
    </form>`;
  if (secondaryLabel) wrapper.querySelector("footer").classList.add("flex-wrap");
  const form = wrapper.querySelector("form");
  const previousFocus = document.activeElement;

  const close = () => {
    wrapper.remove();
    document.removeEventListener("keydown", onKey);
    document.body.style.overflow = "";
    previousFocus?.focus?.();
    onClose?.();
  };
  const onKey = (e) => e.key === "Escape" && close();

  wrapper.addEventListener("click", (e) => {
    if (e.target === wrapper || e.target.closest("[data-close]")) close();
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!onSubmit) return close();
    const invalid = [...form.querySelectorAll("input:invalid, select:invalid, textarea:invalid")].find(
      (el) => !el.closest("[hidden]")
    );
    if (invalid) {
      invalid.reportValidity();
      return;
    }
    const buttons = [...form.querySelectorAll('[type="submit"]')];
    const button = e.submitter?.matches?.('[type="submit"]') ? e.submitter : buttons[0];
    buttons.forEach((b) => (b.disabled = true));
    setButtonLoading(button, true);
    try {
      const keepOpen = await onSubmit(form, { action: button?.dataset.action || "primary" });
      if (keepOpen !== true) close();
    } catch (err) {
      showErrors(form, err);
    } finally {
      setButtonLoading(button, false);
      buttons.forEach((b) => (b.disabled = false));
    }
  });

  document.addEventListener("keydown", onKey);
  document.body.style.overflow = "hidden";
  root().appendChild(wrapper);
  onOpen?.(form);
  if (window.matchMedia("(min-width: 640px)").matches) {
    form.querySelector(".input:not([type=hidden]):not([type=color])")?.focus();
  }
  return { el: form, close };
}

export function showErrors(form, err) {
  form.querySelectorAll(".field-error").forEach((el) => el.remove());
  form.querySelectorAll(".input-error").forEach((el) => el.classList.remove("input-error"));
  const data = err?.data;
  let shown = false;
  if (data && typeof data === "object") {
    Object.entries(data).forEach(([name, messages]) => {
      const fieldEl = form.querySelector(`[name="${name}"]`);
      if (!fieldEl || fieldEl.closest("[hidden]")) return;
      fieldEl.classList.add("input-error");
      const msg = document.createElement("span");
      msg.className = "field-error";
      msg.textContent = Array.isArray(messages) ? messages.join(" ") : messages;
      (fieldEl.closest("label.field") || fieldEl.parentElement).appendChild(msg);
      shown = true;
    });
  }
  if (!shown) toast(err?.message || "Erro ao salvar", true);
}

export function confirmDialog(message, { title = "Confirmar", okLabel = "Confirmar", danger = true } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const { el } = openModal({
      title,
      content: html`<p class="text-sm text-slate-600 dark:text-slate-300">${message}</p>`,
      submitLabel: okLabel,
      danger,
      onSubmit: () => {
        answered = true;
        resolve(true);
      },
    });
    const observer = new MutationObserver(() => {
      if (!el.isConnected) {
        observer.disconnect();
        if (!answered) resolve(false);
      }
    });
    observer.observe(root(), { childList: true });
  });
}

let toastTimer;
export function toast(message, isError = false) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.toggle("!bg-rose-600", isError);
  el.classList.toggle("!text-white", isError);
  el.classList.remove("opacity-0");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("opacity-0"), 3000);
}
