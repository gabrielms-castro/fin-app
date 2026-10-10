function csrfToken() {
  const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

export class ApiError extends Error {
  constructor(status, data) {
    super(ApiError.message(data) || `Erro ${status}`);
    this.status = status;
    this.data = data;
  }

  static message(data) {
    if (!data || typeof data !== "object") return null;
    if (data.detail) return data.detail;
    const first = Object.entries(data)[0];
    if (!first) return null;
    const [, value] = first;
    return Array.isArray(value) ? value[0] : String(value);
  }
}

function buildUrl(path, params) {
  const url = new URL(`/api/${path.replace(/^\//, "")}`, location.origin);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    url.searchParams.set(key, Array.isArray(value) ? value.join(",") : value);
  });
  return url;
}

async function request(method, path, { params, body } = {}) {
  const response = await fetch(buildUrl(path, params), {
    method,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(method !== "GET" ? { "X-CSRFToken": csrfToken() } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (response.status === 401 || response.status === 403) {
    if (!document.cookie.includes("sessionid")) location.href = "/login/";
  }
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, data);
  return data;
}

export const api = {
  get: (path, params) => request("GET", path, { params }),
  post: (path, body = {}) => request("POST", path, { body }),
  put: (path, body) => request("PUT", path, { body }),
  patch: (path, body) => request("PATCH", path, { body }),
  del: (path) => request("DELETE", path),
  url: (path, params) => buildUrl(path, params).toString(),
  /** Salva (POST ou PUT) conforme existir id. */
  save: (resource, data) =>
    data.id ? request("PUT", `${resource}/${data.id}/`, { body: data }) : request("POST", `${resource}/`, { body: data }),
};
