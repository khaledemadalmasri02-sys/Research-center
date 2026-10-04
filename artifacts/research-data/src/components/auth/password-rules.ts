/**
 * ============================================================================
 * PASSWORD RULES — the client mirror of the server's `isValidPassword`
 * ============================================================================
 *
 * `api-server/src/lib/security.ts` is the source of truth: 12+ characters, a
 * lower-case letter, an upper-case letter, a digit, and a symbol. This file
 * restates that list so the form can show a live checklist instead of failing
 * only on submit, and it is consumed by the submit validator too — so the two
 * cannot drift apart inside the frontend.
 *
 * Server-side validation still runs. A mismatch here costs a round trip and a
 * translated `AUTH_PASSWORD_WEAK` banner; it does not bypass anything.
 */

export interface PasswordRule {
  /** Stable id, used as the React key and as the test handle. */
  id: "length" | "lowercase" | "uppercase" | "digit" | "symbol";
  /** i18n key for the rule's label. */
  key: string;
  /** English label used when the key is not translated. */
  fallback: string;
  test: (value: string) => boolean;
}

export const PASSWORD_RULES: readonly PasswordRule[] = [
  {
    id: "length",
    key: "auth.ruleLength",
    fallback: "At least 12 characters",
    test: (value) => value.length >= 12,
  },
  {
    id: "lowercase",
    key: "auth.ruleLowercase",
    fallback: "A lower-case letter",
    test: (value) => /[a-z]/.test(value),
  },
  {
    id: "uppercase",
    key: "auth.ruleUppercase",
    fallback: "An upper-case letter",
    test: (value) => /[A-Z]/.test(value),
  },
  {
    id: "digit",
    key: "auth.ruleDigit",
    fallback: "A number",
    test: (value) => /[0-9]/.test(value),
  },
  {
    id: "symbol",
    key: "auth.ruleSymbol",
    fallback: "A symbol",
    test: (value) => /[^A-Za-z0-9]/.test(value),
  },
] as const;

/** Per-rule results, in declaration order. */
export type PasswordRuleResults = Record<PasswordRule["id"], boolean>;

export function passwordRuleResults(value: string): PasswordRuleResults {
  const out = {} as PasswordRuleResults;
  for (const rule of PASSWORD_RULES) out[rule.id] = rule.test(value);
  return out;
}

/** True when every server rule passes. */
export function isValidPassword(value: string): boolean {
  return PASSWORD_RULES.every((rule) => rule.test(value));
}

/**
 * The first unmet rule, as a translation descriptor — so the inline field
 * error names the specific problem instead of a generic "not strong enough".
 */
export function firstFailedRule(
  value: string,
): { key: string; fallback: string } | null {
  for (const rule of PASSWORD_RULES) {
    if (!rule.test(value)) return { key: rule.key, fallback: rule.fallback };
  }
  return null;
}
