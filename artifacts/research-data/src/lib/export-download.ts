/**
 * Authenticated file download.
 *
 * `records-toolbar.tsx`, `export.tsx` and `deidentify.tsx` previously used a
 * raw `<a href>` or `window.open(url, "_blank")` for server-generated
 * exports. That is a PHI hazard, not just a UX wart: the export endpoints
 * return JSON (not a file) on a 401 or any other error, so the browser
 * navigated the SPA away to a new tab full of raw JSON — and the URL, which
 * may carry filter terms, landed in browser history.
 *
 * `fetch` + `blob()` keeps the SPA in place, propagates a non-2xx response
 * as a rejection the caller can surface, and lets us name the download.
 */
export async function downloadAuthenticated(
  url: string,
  filename: string,
  init: RequestInit = {},
): Promise<void> {
  const res = await fetch(url, {
    credentials: "include",
    ...init,
  });

  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      const ct = res.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) {
        const body = await res.json();
        detail = body?.error ?? body?.message ?? detail;
      }
    } catch {
      /* non-JSON error body */
    }
    throw new Error(`${res.status} ${res.statusText} — ${detail}`);
  }

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a tick to start the download before revoking.
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
}

/**
 * Text-file variant for JSON exports. Kept separate so callers get a
 * `application/json` blob rather than whatever the server sent.
 */
export async function downloadJson(
  url: string,
  filename: string,
  init: RequestInit = {},
): Promise<void> {
  const res = await fetch(url, { credentials: "include", ...init });
  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      const body = await res.json();
      detail = body?.error ?? body?.message ?? detail;
    } catch {
      /* ignore */
    }
    throw new Error(`${res.status} ${res.statusText} — ${detail}`);
  }
  const text = await res.text();
  const blob = new Blob([text], { type: "application/json" });
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
}