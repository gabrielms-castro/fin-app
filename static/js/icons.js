import { raw } from "./format.js";

const toPascal = (name) => name.replace(/(^|-)(\w)/g, (_, __, c) => c.toUpperCase());

const renderNode = ([tag, attrs, children = []]) =>
  `<${tag} ${Object.entries(attrs)
    .map(([k, v]) => `${k}="${v}"`)
    .join(" ")}>${children.map(renderNode).join("")}</${tag}>`;

/** SVG inline de um ícone Lucide (ex.: icon("credit-card", "size-5")). */
export function icon(name, cls = "size-4") {
  const node = window.lucide?.icons?.[toPascal(name)];
  if (!node) return raw("");
  const [tag, attrs, children] = node;
  return raw(renderNode([tag, { ...attrs, class: `shrink-0 ${cls}`, "aria-hidden": "true" }, children]));
}
