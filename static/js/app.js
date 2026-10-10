import { destroyCharts } from "./components/charts.js";
import { toast } from "./components/modal.js";
import { dispatch, fallback, navigate, parseHash, route } from "./router.js";
import { loadMeta, refresh, store } from "./state.js";
import { openExpenseForm } from "./views/expense-form.js";
import * as assinaturas from "./views/assinaturas.js";
import * as cartoes from "./views/cartoes.js";
import * as config from "./views/config.js";
import * as dashboard from "./views/dashboard.js";
import * as dividas from "./views/dividas.js";
import * as faturas from "./views/faturas.js";
import * as investimentos from "./views/investimentos.js";
import * as lancamentos from "./views/lancamentos.js";
import * as receitas from "./views/receitas.js";
import * as recorrentes from "./views/recorrentes.js";

const app = document.getElementById("app");

function mount(view) {
  return async (ctx) => {
    destroyCharts();
    const container = document.createElement("div");
    app.replaceChildren(container);
    try {
      await view.render(container, ctx);
    } catch (err) {
      console.error(err);
      container.innerHTML = '<div class="card empty">Não foi possível carregar esta página.</div>';
      toast(err.message || "Erro inesperado", true);
    }
  };
}

route("/dashboard", mount(dashboard));
route("/lancamentos", mount(lancamentos));
route("/cartoes", mount(cartoes));
route("/cartoes/:id", mount(faturas));
route("/assinaturas", mount(assinaturas));
route("/dividas", mount(dividas));
route("/investimentos", mount(investimentos));
route("/receitas", mount(receitas));
route("/recorrentes", mount(recorrentes));
route("/config", mount(config));
fallback(() => navigate("#/dashboard"));

function highlightNav() {
  const section = parseHash().path.split("/")[1];
  document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === section));
  document.getElementById("more-menu").hidden = true;
}

async function onRoute() {
  highlightNav();
  await dispatch();
  app.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

document.addEventListener("click", async (e) => {
  const action = e.target.closest("[data-action]")?.dataset.action;
  if (action === "quick-add") {
    await openExpenseForm();
    dispatch();
  } else if (action === "more-menu") {
    document.getElementById("more-menu").hidden = false;
  } else if (e.target.id === "more-menu") {
    e.target.hidden = true;
  }
});

window.addEventListener("unhandledrejection", (e) => {
  toast(e.reason?.message || "Erro inesperado", true);
});

async function start() {
  await Promise.all([loadMeta(), refresh()]);
  if (!store.categories.length) toast("Configure blocos, naturezas e grupos em Configurações.");
  window.addEventListener("hashchange", onRoute);
  if (!location.hash) history.replaceState(null, "", "#/dashboard");
  onRoute();
}

start();
