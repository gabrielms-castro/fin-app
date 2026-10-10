import { isDark } from "../format.js";

const charts = new Map();

export const PALETTE = ["#6366f1", "#f59e0b", "#10b981", "#ef4444", "#0ea5e9", "#a855f7", "#14b8a6", "#f97316", "#84cc16", "#ec4899", "#64748b", "#eab308"];

export function renderChart(canvas, config) {
  if (!canvas || !window.Chart) return null;
  charts.get(canvas.id)?.destroy();
  const { Chart } = window;
  const dark = isDark();
  Chart.defaults.color = dark ? "#94a3b8" : "#64748b";
  Chart.defaults.borderColor = dark ? "#1e293b" : "#e2e8f0";
  Chart.defaults.font.family = "Inter, ui-sans-serif, system-ui, sans-serif";
  const chart = new Chart(canvas, {
    ...config,
    options: { responsive: true, maintainAspectRatio: false, ...config.options },
  });
  charts.set(canvas.id, chart);
  return chart;
}

export function destroyCharts() {
  charts.forEach((chart) => chart.destroy());
  charts.clear();
}

export const moneyTick = (value) =>
  Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
