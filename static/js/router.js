const routes = [];
let notFound = null;

export function route(pattern, handler) {
  const keys = [];
  const regex = new RegExp(
    `^${pattern.replace(/\//g, "\\/").replace(/:(\w+)/g, (_, k) => (keys.push(k), "([^/]+)"))}$`
  );
  routes.push({ regex, keys, handler });
}

export const fallback = (handler) => (notFound = handler);

export function parseHash() {
  const hash = location.hash.replace(/^#/, "") || "/dashboard";
  const [path, query = ""] = hash.split("?");
  return { path, query: Object.fromEntries(new URLSearchParams(query)) };
}

/** Atualiza a querystring do hash sem re-renderizar a página. */
export function setQuery(query) {
  const { path } = parseHash();
  const clean = Object.fromEntries(Object.entries(query).filter(([, v]) => v !== "" && v !== null && v !== undefined));
  const qs = new URLSearchParams(clean).toString();
  history.replaceState(null, "", `#${path}${qs ? `?${qs}` : ""}`);
}

export function navigate(hash) {
  location.hash = hash;
}

export async function dispatch() {
  const { path, query } = parseHash();
  for (const { regex, keys, handler } of routes) {
    const match = path.match(regex);
    if (match) {
      const params = Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(match[i + 1])]));
      return handler({ params, query, path });
    }
  }
  return notFound?.({ path, query });
}
