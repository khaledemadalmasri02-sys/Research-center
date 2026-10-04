import { describe, it, expect } from "vitest";

import {
  INITIAL_RECOVERY_STATE,
  RESEND_COOLDOWN_SEC,
  isRequestSent,
  isTokenProblem,
  recoveryReducer,
  resetTokenProblem,
  type RecoveryState,
} from "@/components/auth/recovery-machine";
import {
  PASSWORD_RULES,
  firstFailedRule,
  isValidPassword,
  passwordRuleResults,
} from "@/components/auth/password-rules";

/**
 * ============================================================================
 * PASSWORD RECOVERY FLOW
 * ============================================================================
 *
 * There was no recovery flow at all before this: `forgot` appeared zero times
 * in the app, so a user who forgot their password was locked out permanently.
 *
 * Two properties are worth more than the individual assertions below and are
 * what these tests really pin:
 *
 *  1. The request endpoint is NEUTRAL, and the state machine has no state that
 *     could encode whether the account exists. `requested` goes straight to
 *     `request-sent` and retains nothing from the response.
 *  2. The four ways a reset link can be useless are four different states with
 *     four different remedies, not one `error` flag.
 */

function reduce(
  state: RecoveryState,
  ...events: Parameters<typeof recoveryReducer>[1][]
): RecoveryState {
  return events.reduce(recoveryReducer, state);
}

describe("password recovery — request half", () => {
  it("starts on an editable request form", () => {
    expect(INITIAL_RECOVERY_STATE).toEqual({
      step: "request",
      cooldownSec: 0,
      canResend: false,
      requiresNewLink: false,
      editable: true,
    });
  });

  it("collapses a neutral response into exactly one 'sent' state", () => {
    // Nothing from the request response is retained: there is no field here
    // that could say "this account exists".
    const next = reduce(INITIAL_RECOVERY_STATE, { type: "requested" });
    expect(next.step).toBe("request-sent");
    expect(next.cooldownSec).toBe(RESEND_COOLDOWN_SEC);
    expect(next.canResend).toBe(false);
    expect(next.editable).toBe(false);
    expect(isRequestSent(next)).toBe(true);
    expect(Object.keys(next).sort()).toEqual(
      ["canResend", "cooldownSec", "editable", "requiresNewLink", "step"].sort(),
    );
  });

  it("honours a server-supplied cooldown", () => {
    const next = reduce(INITIAL_RECOVERY_STATE, {
      type: "requested",
      cooldownSec: 15,
    });
    expect(next.cooldownSec).toBe(15);
  });

  it("counts the cooldown down and unlocks resend at zero", () => {
    let state = reduce(INITIAL_RECOVERY_STATE, { type: "requested", cooldownSec: 2 });
    state = reduce(state, { type: "cooldown-ticked" });
    expect(state.cooldownSec).toBe(1);
    expect(state.canResend).toBe(false);
    state = reduce(state, { type: "cooldown-ticked" });
    expect(state.cooldownSec).toBe(0);
    expect(state.canResend).toBe(true);
  });

  it("ignores a tick that lands after the cooldown already expired", () => {
    const sent = reduce(INITIAL_RECOVERY_STATE, { type: "requested", cooldownSec: 1 });
    const expired = reduce(sent, { type: "cooldown-ticked" });
    // A tick that fires as the component unmounts must be inert, not negative.
    expect(reduce(expired, { type: "cooldown-ticked" })).toBe(expired);
  });

  it("refuses a resend during the cooldown (double-submit guard)", () => {
    const sent = reduce(INITIAL_RECOVERY_STATE, { type: "requested", cooldownSec: 30 });
    expect(reduce(sent, { type: "resend-sent" })).toBe(sent);
  });

  it("allows a resend once the cooldown has elapsed, and restarts it", () => {
    const ready = reduce(
      reduce(INITIAL_RECOVERY_STATE, { type: "requested", cooldownSec: 1 }),
      { type: "cooldown-ticked" },
    );
    const again = reduce(ready, { type: "resend-sent", cooldownSec: 45 });
    expect(again.step).toBe("request-sent");
    expect(again.cooldownSec).toBe(45);
    expect(again.canResend).toBe(false);
  });

  it("returns to an editable form when the request itself fails", () => {
    const sent = reduce(INITIAL_RECOVERY_STATE, { type: "requested" });
    const failed = reduce(sent, { type: "request-failed" });
    expect(failed.step).toBe("request");
    expect(failed.editable).toBe(true);
    expect(failed.canResend).toBe(false);
  });

  it("starts over cleanly", () => {
    const sent = reduce(INITIAL_RECOVERY_STATE, { type: "requested", cooldownSec: 60 });
    expect(reduce(sent, { type: "start-over" })).toEqual(INITIAL_RECOVERY_STATE);
  });
});

describe("password recovery — token problems", () => {
  it("classifies each token code to its own step", () => {
    expect(resetTokenProblem("AUTH_RESET_TOKEN_EXPIRED")).toBe("token-expired");
    expect(resetTokenProblem("AUTH_RESET_TOKEN_USED")).toBe("token-used");
    expect(resetTokenProblem("AUTH_RESET_TOKEN_INVALID")).toBe("token-invalid");
    expect(resetTokenProblem("AUTH_RECOVERY_INVALID")).toBe("token-invalid");
  });

  it("treats any other code as 'not a token problem'", () => {
    expect(resetTokenProblem(null)).toBeNull();
    expect(resetTokenProblem(undefined)).toBeNull();
    expect(resetTokenProblem("")).toBeNull();
    // A 429 on `confirm` is about waiting, not about the link: reporting it as
    // an expired link would send the user round a pointless loop.
    expect(resetTokenProblem("AUTH_RATE_LIMITED")).toBeNull();
    expect(resetTokenProblem("AUTH_FUTURE_CODE")).toBeNull();
  });

  it("gives the three token failures genuinely different terminal states", () => {
    const entered = reduce(INITIAL_RECOVERY_STATE, { type: "token-received" });
    expect(entered.step).toBe("reset");
    expect(entered.editable).toBe(true);

    const steps = [
      "AUTH_RESET_TOKEN_EXPIRED",
      "AUTH_RESET_TOKEN_USED",
      "AUTH_RESET_TOKEN_INVALID",
    ].map((code) => reduce(entered, { type: "reset-failed", code }).step);

    expect(new Set(steps).size).toBe(3);
    // Each one is terminal: no inputs, and the only way out is a new link.
    for (const code of [
      "AUTH_RESET_TOKEN_EXPIRED",
      "AUTH_RESET_TOKEN_USED",
      "AUTH_RESET_TOKEN_INVALID",
    ]) {
      const state = reduce(entered, { type: "reset-failed", code });
      expect(state.editable, code).toBe(false);
      expect(state.requiresNewLink, code).toBe(true);
      expect(isTokenProblem(state), code).toBe(true);
    }
  });

  it("keeps a code we do not recognise retryable rather than blaming the link", () => {
    const entered = reduce(INITIAL_RECOVERY_STATE, { type: "token-received" });
    const state = reduce(entered, { type: "reset-failed", code: "AUTH_FUTURE_CODE" });
    expect(state.step).toBe("failed");
    expect(state.editable).toBe(true);
    expect(state.requiresNewLink).toBe(false);
  });

  it("keeps the retry affordance for a failure with no token code", () => {
    const entered = reduce(INITIAL_RECOVERY_STATE, { type: "token-received" });
    const state = reduce(entered, { type: "reset-failed", code: null });
    expect(state.step).toBe("failed");
    expect(state.editable).toBe(true);
    expect(state.requiresNewLink).toBe(false);
    expect(isTokenProblem(state)).toBe(false);
  });

  it("locks the form when the deep link carried no token", () => {
    const state = reduce(INITIAL_RECOVERY_STATE, { type: "token-missing" });
    expect(state.step).toBe("token-missing");
    expect(state.editable).toBe(false);
    expect(state.requiresNewLink).toBe(true);
    expect(isTokenProblem(state)).toBe(true);
  });

  it("does not let a token problem be escaped by a stray tick or resend", () => {
    const expired = reduce(
      reduce(INITIAL_RECOVERY_STATE, { type: "token-received" }),
      { type: "reset-failed", code: "AUTH_RESET_TOKEN_EXPIRED" },
    );
    expect(reduce(expired, { type: "cooldown-ticked" })).toBe(expired);
    expect(reduce(expired, { type: "resend-sent" })).toBe(expired);
  });

  it("reaches a terminal success state", () => {
    const done = reduce(
      reduce(INITIAL_RECOVERY_STATE, { type: "token-received" }),
      { type: "reset-succeeded" },
    );
    expect(done.step).toBe("reset-done");
    expect(done.editable).toBe(false);
    expect(done.requiresNewLink).toBe(false);
    expect(isTokenProblem(done)).toBe(false);
  });

  it("walks the whole happy path without losing the cooldown invariant", () => {
    const state = reduce(
      INITIAL_RECOVERY_STATE,
      { type: "requested", cooldownSec: 1 },
      { type: "cooldown-ticked" },
      { type: "resend-sent", cooldownSec: 1 },
      { type: "cooldown-ticked" },
      { type: "token-received" },
      { type: "reset-succeeded" },
    );
    expect(state.step).toBe("reset-done");
    expect(state.canResend).toBe(false);
  });

  it("returns the same state for an unknown event", () => {
    const sent = reduce(INITIAL_RECOVERY_STATE, { type: "requested" });
    expect(
      recoveryReducer(sent, { type: "not-a-real-event" } as never),
    ).toBe(sent);
  });
});

describe("password rules mirror the server rule", () => {
  const valid = "Str0ng-Passphrase!";

  it("accepts a password meeting all five server rules", () => {
    expect(isValidPassword(valid)).toBe(true);
    expect(passwordRuleResults(valid)).toEqual({
      length: true,
      lowercase: true,
      uppercase: true,
      digit: true,
      symbol: true,
    });
  });

  it("rejects each rule individually", () => {
    expect(isValidPassword("Sh0rt-Pass!")).toBe(false); // 11 characters
    expect(isValidPassword("nouppercase0!here")).toBe(false);
    expect(isValidPassword("NOLOWERCASE0!HERE")).toBe(false);
    expect(isValidPassword("NoDigitsHere!!!")).toBe(false);
    expect(isValidPassword("NoSymbolsHere00")).toBe(false);
    expect(isValidPassword("")).toBe(false);
  });

  it("counts the length rule at exactly 12", () => {
    expect(isValidPassword("Aa1!aaaaaaa")).toBe(false); // 11
    expect(isValidPassword("Aa1!aaaaaaaa")).toBe(true); // 12
  });

  it("names the first unmet rule, so the message is specific", () => {
    expect(firstFailedRule(valid)).toBeNull();
    expect(firstFailedRule("Sh0rt-Pass!")?.key).toBe("auth.ruleLength");
    expect(firstFailedRule("alllowercase0!")?.key).toBe("auth.ruleUppercase");
    expect(firstFailedRule("ALLUPPERCASE0!")?.key).toBe("auth.ruleLowercase");
    expect(firstFailedRule("NoDigitsHere!!")?.key).toBe("auth.ruleDigit");
    expect(firstFailedRule("NoSymbolsHere00")?.key).toBe("auth.ruleSymbol");
  });

  it("has a unique key and label per rule", () => {
    expect(new Set(PASSWORD_RULES.map((r) => r.key)).size).toBe(PASSWORD_RULES.length);
    expect(new Set(PASSWORD_RULES.map((r) => r.fallback)).size).toBe(
      PASSWORD_RULES.length,
    );
    expect(PASSWORD_RULES).toHaveLength(5);
  });
});
