// Pre-send guard: asks the Worker (via its /api/unsubscribe/status endpoint)
// whether the recipient has unsubscribed. If yes, the email is skipped.
//
// Design notes
// - Fail-open: if the Worker is unreachable or the lookup times out, the
//   email is sent anyway. Sends are more important than blocking, and a
//   transient Worker outage should not break OTP delivery.
// - In-process TTL cache (60s) to avoid hammering the Worker on every send
//   while still picking up new unsubscribes within a minute.
// - Bounded LRU (500 entries) so the cache doesn't grow unbounded under
//   high recipient volume.

const DEFAULT_TIMEOUT_MS = 800;
const DEFAULT_TTL_MS = 60_000;
const CACHE_MAX = 500;

type Entry = { allowed: boolean; expiresAt: number };

const cache = new Map<string, Entry>();
let inflight: Map<string, Promise<boolean>> | null = null;

function nowMs() {
  return Date.now();
}

function pruneCache() {
  if (cache.size <= CACHE_MAX) return;
  // Map preserves insertion order; drop oldest until back under cap.
  const overflow = cache.size - CACHE_MAX;
  const it = cache.keys();
  for (let i = 0; i < overflow; i++) {
    const k = it.next().value;
    if (k === undefined) break;
    cache.delete(k);
  }
}

function inflightMap(): Map<string, Promise<boolean>> {
  if (!inflight) inflight = new Map();
  return inflight;
}

export interface GuardInput {
  to: string | string[];
  category?: string;
}

export interface GuardEnv {
  /** Base URL of the Worker (e.g. https://research-center.fit). */
  MAIL_UNSUBSCRIBE_LOOKUP_URL?: string;
  /** Optional shared secret; sent as `x-mail-unsubscribe-token`. */
  MAIL_UNSUBSCRIBE_LOOKUP_TOKEN?: string;
  /** Override timeout in ms. */
  MAIL_UNSUBSCRIBE_TIMEOUT_MS?: string;
  /** Override cache TTL in ms. */
  MAIL_UNSUBSCRIBE_CACHE_TTL_MS?: string;
}

function getRecipients(input: GuardInput): string[] {
  if (Array.isArray(input.to)) return input.to;
  return [input.to];
}

function isUnsubscribed(status: unknown, category: string | undefined): boolean {
  if (!status || typeof status !== "object") return false;
  const s = status as {
    unsubscribedAll?: boolean;
    unsubscribedCategories?: string[];
  };
  if (s.unsubscribedAll === true) return true;
  if (category && Array.isArray(s.unsubscribedCategories)) {
    return s.unsubscribedCategories.includes(category);
  }
  return false;
}

async function lookupOnce(
  base: string,
  email: string,
  category: string | undefined,
  token: string | undefined,
  timeoutMs: number,
): Promise<boolean> {
  const url = `${base.replace(/\/+$/, "")}/api/unsubscribe/status?email=${encodeURIComponent(email)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        ...(token ? { "x-mail-unsubscribe-token": token } : {}),
      },
      signal: controller.signal,
    });
    if (!res.ok) return true; // fail-open
    const data = (await res.json().catch(() => null)) as unknown;
    return !isUnsubscribed(data, category);
  } catch {
    return true; // fail-open
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Returns false if any recipient is known to have unsubscribed.
 * Returns true if all recipients are allowed (or the guard is not configured
 * or the lookup failed — see fail-open above).
 */
export async function checkUnsubscribed(
  input: GuardInput,
  env: GuardEnv = process.env as GuardEnv,
): Promise<boolean> {
  const base = env.MAIL_UNSUBSCRIBE_LOOKUP_URL;
  if (!base) return true;

  const ttl = Number(env.MAIL_UNSUBSCRIBE_CACHE_TTL_MS ?? DEFAULT_TTL_MS);
  const timeoutMs = Number(env.MAIL_UNSUBSCRIBE_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const category = input.category;

  const recipients = getRecipients(input);
  const allowedResults = await Promise.all(
    recipients.map(async (email) => {
      const key = category ? `${email}::${category}` : email;
      const fresh = cache.get(key);
      if (fresh && fresh.expiresAt > nowMs()) {
        return fresh.allowed;
      }

      // Coalesce concurrent lookups for the same recipient.
      const inflightKey = key;
      const pending = inflightMap().get(inflightKey);
      if (pending) {
        return pending;
      }
      const p = (async () => {
        const allowed = await lookupOnce(base, email, category, env.MAIL_UNSUBSCRIBE_LOOKUP_TOKEN, timeoutMs);
        cache.set(key, { allowed, expiresAt: nowMs() + ttl });
        pruneCache();
        return allowed;
      })();
      inflightMap().set(inflightKey, p);
      try {
        return await p;
      } finally {
        inflightMap().delete(inflightKey);
      }
    }),
  );

  return allowedResults.every(Boolean);
}

/** Test-only: clear the in-memory cache. */
export function _resetUnsubscribeCache() {
  cache.clear();
  if (inflight) inflight.clear();
}
