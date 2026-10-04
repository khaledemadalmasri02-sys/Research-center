import { useCallback, useState } from "react";

/**
 * ============================================================================
 * CAPS-LOCK DETECTION
 * ============================================================================
 *
 * Caps-lock is one of the most common causes of an auth support ticket and it
 * is completely invisible: the user types their password, it is all shifted,
 * and the server correctly rejects it. Telling them *while they type* is the
 * entire fix.
 *
 * Design constraints, all of them non-negotiable:
 *  - NEVER block input. Caps-lock is advisory; a password can legitimately
 *    contain capitals, and a field that refuses keystrokes is worse than the
 *    problem it solves.
 *  - Read `getModifierState("CapsLock")` rather than inferring from the
 *    character the user typed. Inferring breaks on non-Latin layouts and on
 *    Shift+letter, and this app has an Arabic locale.
 *  - `getModifierState` is absent in some environments (old jsdom, synthetic
 *    events), so every read is guarded — an unguarded call is a crash on
 *    mount in exactly the environment the tests run in.
 */
export interface CapsLockBindings {
  /** Attach to the password input. */
  capsLockOn: boolean;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onKeyUp: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onFocus: (e: React.FocusEvent<HTMLInputElement>) => void;
  onBlur: () => void;
}

type ModifierEvent =
  | React.KeyboardEvent<HTMLInputElement>
  | React.FocusEvent<HTMLInputElement>;

function readCapsLock(e: ModifierEvent): boolean {
  const modifier = (e as { getModifierState?: (key: string) => boolean })
    .getModifierState;
  if (typeof modifier !== "function") return false;
  try {
    return modifier.call(e, "CapsLock") === true;
  } catch {
    return false;
  }
}

export function useCapsLock(): CapsLockBindings {
  const [capsLockOn, setCapsLockOn] = useState(false);

  const sync = useCallback((e: ModifierEvent) => {
    setCapsLockOn(readCapsLock(e));
  }, []);

  return {
    capsLockOn,
    onKeyDown: sync,
    onKeyUp: sync,
    // Focus matters: caps-lock can already be on when the field is focused via
    // a password manager or a restored form, with no keystroke to observe.
    onFocus: sync,
    // Blur clears it: the warning must not follow the user to another field.
    onBlur: useCallback(() => setCapsLockOn(false), []),
  };
}
