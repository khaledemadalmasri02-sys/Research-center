// Thin fetch wrapper for the worker API.
// - sends session cookie (credentials: include) for /api/auth/login sessions
// - sends Bearer token from localStorage when present (API-token users)
// - attaches X-CSRF-Token on mutations (cached from GET /api/csrf)
let csrfToken: string | null = null;
let csrfPromise: Promise<string | null> | null = null;

async function getCsrf(): Promise<string | null> {
  if (csrfToken) return csrfToken;
  if (csrfPromise) return csrfPromise;
  csrfPromise = fetch("/api/csrf", { credentials: "include" })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      csrfToken = d?.csrfToken ?? null;
      return csrfToken;
    })
    .catch(() => null)
    .finally(() => {
      csrfPromise = null;
    });
  return csrfPromise;
}

export class ApiError extends Error {
  status: number;
  data: any;
  constructor(message: string, status: number, data: any) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export async function api<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const method = (opts.method || "GET").toUpperCase();
  const headers = new Headers(opts.headers);
  const token = typeof localStorage !== "undefined" ? localStorage.getItem("token") : null;
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (opts.body && !(opts.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (method !== "GET" && method !== "HEAD") {
    const csrf = await getCsrf();
    if (csrf) headers.set("X-CSRF-Token", csrf);
  }
  const res = await fetch(path, { ...opts, method, headers, credentials: "include" });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new ApiError(data?.error || res.statusText || "Request failed", res.status, data);
  }
  return data as T;
}

export const apiGet = <T = any>(p: string) => api<T>(p);
export const apiPost = <T = any>(p: string, body?: any) =>
  api<T>(p, { method: "POST", body: body ? JSON.stringify(body) : undefined });
export const apiDelete = <T = any>(p: string) => api<T>(p, { method: "DELETE" });
export const apiPatch = <T = any>(p: string, body?: any) =>
  api<T>(p, { method: "PATCH", body: body ? JSON.stringify(body) : undefined });
