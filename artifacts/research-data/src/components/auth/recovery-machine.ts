/**
 * ============================================================================
 * PASSWORD RECOVERY STATE MACHINE
 * ============================================================================
 *
 * Why a reducer instead of `useState` calls scattered through the two pages:
 *
 *  1. The request endpoint answers **neutrally** — a 200 whether or not the
 *     account exists. The whole point of that design is that the UI cannot
 *     distinguish the two cases, so the UI must have no state that *could*
 *     encode the distinction. Here, `requested` collapses straight to
 *     `request-sent` with nothing retained from the response, so there is no
 *     place for "account not found" to leak in later.
 *
 *  2. The reset half has four genuinely different dead ends — no token in the
 *     URL, a tampered link, an expired link, an already-used link. Only the
 *     last one is idempotent (someone may legitimately have just reset), so
 *     they are separate steps rather than one `error` flag with a message
 *     swapped at the render site.
 *
 * It is a pure reducer with no React and no i18n, so the interesting
 * behaviour — cooldown expiry, which failures allow a retry — is testable
 * without rendering anything.
 */

/** Where the user is in the recovery flow. */
export type RecoveryStep =
  /** Typing an email or username into the request form. */
  | "request"
  /** Neutral confirmation shown; resend is throttled for a cooldown. */
  | "request-sent"
  /** Token received: choosing and confirming a new password. */
  | "reset"
  /** Password accepted. */
  | "reset-done"
  /** Deep link carried no `?token=` — nothing can be confirmed. */
  | "token-missing"
  /** The link was altered or is not a reset token at all. */
  | "token-invalid"
  /** The link worked but the short validity window has passed. */
  | "token-expired"
  /** The link was already redeemed. */
  | "token-used"
  /** A failure that a plain retry could clear (network, weak password). */
  | "failed";

export interface RecoveryState {
  step: RecoveryStep;
  /** Whole seconds left on the resend cooldown. */
  cooldownSec: number;
  /** Whether the resend affordance is currently usable. */
  canResend: boolean;
  /**
   * The user has to go back and request a fresh link before anything else can
   * be typed. True for every terminal token problem.
   */
  requiresNewLink: boolean;
  /** Whether the form fields accept input in this step. */
  editable: boolean;
}

export type RecoveryEvent =
  /** The request endpoint answered (neutrally). */
  | { type: "requested"; cooldownSec?: number }
  /** One second of the resend cooldown elapsed. */
  | { type: "cooldown-ticked" }
  /** The user pressed resend; only legal when {@link RecoveryState.canResend}. */
  | { type: "resend-sent"; cooldownSec?: number }
  /** The request itself failed (429, network). */
  | { type: "request-failed" }
  /** A usable token arrived, from the URL or from the response. */
  | { type: "token-received" }
  /** The URL had no token. */
  | { type: "token-missing" }
  /** Confirm failed with a backend code, if it sent one. */
  | { type: "reset-failed"; code?: string | null }
  /** Confirm succeeded. */
  | { type: "reset-succeeded" }
  /** Start over: back to an empty request form. */
  | { type: "start-over" };

/** Seconds a resend stays disabled after a request. */
export const RESEND_COOLDOWN_SEC = 60;

export const INITIAL_RECOVERY_STATE: RecoveryState = {
  step: "request",
  cooldownSec: 0,
  canResend: false,
  requiresNewLink: false,
  editable: true,
};

const sent = (cooldownSec: number): RecoveryState => ({
  step: "request-sent",
  cooldownSec: Math.max(0, Math.ceil(cooldownSec)),
  canResend: cooldownSec <= 0,
  requiresNewLink: false,
  editable: false,
});

const problem = (step: RecoveryStep): RecoveryState => ({
  step,
  cooldownSec: 0,
  canResend: false,
  requiresNewLink: true,
  editable: false,
});

/**
 * Map a backend code onto a terminal token step.
 *
 * `null` means "not a token problem" — the caller keeps the retry affordance.
 *
 * The enumeration is CLOSED on purpose. Only codes that positively indicate a
 * dead link become a terminal step; everything else, including a code nobody
 * has seen yet, stays retryable. The asymmetry is the point: falsely telling a
 * user their valid link is expired sends them round a pointless loop, while
 * showing a retryable failure on a genuinely dead link costs one extra press.
 */
export function resetTokenProblem(code?: string | null): RecoveryStep | null {
  switch (code) {
    case "AUTH_RESET_TOKEN_EXPIRED":
      return "token-expired";
    case "AUTH_RESET_TOKEN_USED":
      return "token-used";
    case "AUTH_RESET_TOKEN_INVALID":
    case "AUTH_RECOVERY_INVALID":
      return "token-invalid";
    default:
      // Includes null/undefined/"" (nothing to go on) and every other code:
      // a 429 on `confirm` must not be reported as a broken link.
      return null;
  }
}

/**
 * Pure reducer. Unknown or illegal combinations return the state unchanged
 * rather than throwing: a double-submitted resend or a tick that lands after
 * unmount must be inert, not fatal.
 */
export function recoveryReducer(
  state: RecoveryState,
  event: RecoveryEvent,
): RecoveryState {
  switch (event.type) {
    case "requested":
      return sent(event.cooldownSec ?? RESEND_COOLDOWN_SEC);

    case "cooldown-ticked": {
      if (state.step !== "request-sent" || state.cooldownSec <= 0) return state;
      const next = state.cooldownSec - 1;
      return { ...state, cooldownSec: next, canResend: next <= 0 };
    }

    case "resend-sent": {
      // Hard guard against the double-submit: a resend that gets through
      // during the cooldown would let a user spam the endpoint.
      if (state.step !== "request-sent" || !state.canResend) return state;
      return sent(event.cooldownSec ?? RESEND_COOLDOWN_SEC);
    }

    case "request-failed":
      // Back to an editable form. `canResend` is irrelevant in the `request`
      // step, so it stays false: the resend button only exists after a send.
      return { ...INITIAL_RECOVERY_STATE };

    case "token-received":
      return {
        step: "reset",
        cooldownSec: 0,
        canResend: false,
        requiresNewLink: false,
        editable: true,
      };

    case "token-missing":
      return problem("token-missing");

    case "reset-failed": {
      const tokenStep = resetTokenProblem(event.code);
      if (tokenStep) return problem(tokenStep);
      // Retryable failure: keep the token and the focus, let them try again.
      return {
        step: "failed",
        cooldownSec: 0,
        canResend: false,
        requiresNewLink: false,
        editable: true,
      };
    }

    case "reset-succeeded":
      return {
        step: "reset-done",
        cooldownSec: 0,
        canResend: false,
        requiresNewLink: false,
        editable: false,
      };

    case "start-over":
      return { ...INITIAL_RECOVERY_STATE };

    default:
      return state;
  }
}

/** True while the user is staring at the post-request confirmation. */
export function isRequestSent(state: RecoveryState): boolean {
  return state.step === "request-sent";
}

/**
 * The four token problems share a shape (no inputs, one way out) but not their
 * copy, so the render site branches on `step` and this only decides the
 * layout. `token-used` is included here rather than being folded into the
 * "request a new link" case: it also offers sign-in for the case where the
 * user *did* just reset it and lost the new password.
 */
export function isTokenProblem(state: RecoveryState): boolean {
  return (
    state.step === "token-missing" ||
    state.step === "token-invalid" ||
    state.step === "token-expired" ||
    state.step === "token-used"
  );
}
