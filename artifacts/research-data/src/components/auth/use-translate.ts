import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";

import { tr, type AuthTranslate } from "@/lib/auth-errors";

/**
 * `t` for the auth surface, with one guarantee: **you always get real copy.**
 *
 * The signature is `(key, englishFallback, params?)`. Callers pass the English
 * string they want shown, which means:
 *
 *  - The key is resolved through i18next, so `ar.ts` wins when it has the key.
 *  - A missing key still renders English rather than the key itself, because
 *    `tr` in `@/lib/auth-errors` detects the miss and substitutes the fallback.
 *  - `{{placeholders}}` are interpolated on whichever path wins, so the
 *    fallback is never left with raw `{{seconds}}` in it.
 *
 * Passing the fallback at every call site is deliberate. It is what makes a
 * missing translation a cosmetic gap rather than a screen showing a user
 * `auth.errAccountLocked`.
 *
 * The returned function is referentially stable for the lifetime of the
 * component — i18next's `t` identity changes between renders, so it is read
 * through a ref rather than captured — which keeps this safe to pass to
 * memoised children.
 */
export function useAuthTranslate(): { t: AuthTranslate } {
  const { t: rawT } = useTranslation();
  const latest = useRef(rawT as unknown as AuthTranslate);
  latest.current = rawT as unknown as AuthTranslate;

  const t = useCallback<AuthTranslate>(
    (key, fallback, params) => tr(latest.current, key, fallback ?? "", params),
    [],
  );

  return { t };
}
