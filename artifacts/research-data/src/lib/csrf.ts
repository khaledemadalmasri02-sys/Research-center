// Centralized CSRF handling for the Cloudflare Worker edge.
//
// The production Worker (research/src/index.ts) enforces a CSRF double-submit
// token on every mutating same-origin /api/* request that is authenticated with
// the session cookie. It exposes GET /api/csrf which sets a `csrf` cookie. This
// wrapper ensures the SPA obtains that token and echoes it back as the
// `X-CSRF-Token` header on every mutating same-origin /api request.
//
// Locally (Vite dev proxy) the API server does not enforce CSRF, and it has no
// /api/csrf route, so the token fetch fails gracefully and no header is added —
// the request still works.

function readCookie(name: string): string | undefined {
  const match = document.cookie.match(
    new RegExp("(?:^|; )" + name.replace(/([.*+?^${}()|[\]\\])/g, "\\$1") + "=([^;]*)"),
  );
  return match ? decodeURIComponent(match[1]) : undefined;
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
let tokenPromise: Promise<string | undefined> | null = null;

async function ensureCsrfToken(): Promise<string | undefined> {
  const existing = readCookie("csrf");
  if (existing) return existing;
  if (!tokenPromise) {
    tokenPromise = fetch("/api/csrf", {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    })
      .then(() => readCookie("csrf"))
      .catch(() => undefined)
      .finally(() => {
        // Allow a later retry if this attempt failed.
        tokenPromise = null;
      });
  }
  return tokenPromise;
}

export function installCsrfFetch(): void {
  if (typeof window === "undefined" || typeof window.fetch !== "function") return;
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input as RequestInfo, init);
    let url: URL;
    try {
      url = new URL(request.url, location.href);
    } catch {
      return original(request);
    }
    if (
      url.origin === location.origin &&
      url.pathname.startsWith("/api") &&
      MUTATING.has(request.method.toUpperCase())
    ) {
      const token = await ensureCsrfToken();
      if (token) request.headers.set("X-CSRF-Token", token);
    }
    return original(request);
  };
}
