import * as React from "react";

/**
 * localStorage-backed draft persistence for a clinical record form.
 *
 * A refresh, a tab crash, or a laptop lid close otherwise destroys every
 * keystroke in a 40-field patient record. The draft is namespaced by patient
 * id so two open forms do not collide, and it is written on a debounce so we
 * are not serialising the whole record on every keystroke.
 *
 * PRIVACY. These drafts are **PHI**, not preferences: a draft is the full
 * set of field values the operator has typed for one patient, including names,
 * complaints and diagnoses. An earlier version of this comment claimed
 * "nothing secret is stored here" — that was wrong.
 *
 * Consequences that are handled rather than ignored:
 *  - Drafts are namespaced by patient so two open forms cannot collide, and
 *    they are written on a debounce so the whole record is not serialised on
 *    every keystroke.
 *  - `clear()` removes the draft once the record is saved through the API.
 *  - `clearAllRecordDrafts()` wipes every draft on logout. localStorage is
 *    origin-scoped, not session-scoped, so without this the next person to use
 *    a shared reading-room workstation can open the same patient id and be
 *    handed the previous operator's unsaved work.
 *  - Drafts are best-effort: a quota failure or private mode silently disables
 *    persistence rather than blocking data entry.
 */

const PREFIX = "mr_draft:patient:";
export const DRAFT_DEBOUNCE_MS = 2_000;

function draftKey(patientKey: string) {
  return `${PREFIX}${patientKey}`;
}

/**
 * Remove every persisted draft regardless of patient. Called on logout so PHI
 * does not outlive the session that produced it. Iterates keys in reverse
 * because `removeItem` mutates the live key list.
 */
export function clearAllRecordDrafts(): number {
  if (typeof window === "undefined") return 0;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(PREFIX)) doomed.push(key);
    }
    for (const key of doomed) window.localStorage.removeItem(key);
    return doomed.length;
  } catch {
    // Private mode / storage disabled: nothing persisted, nothing to clear.
    return 0;
  }
}

export interface DraftEnvelope<T> {
  savedAt: string;
  data: T;
}

export function useRecordDraft<T>(patientKey: string, value: T, enabled = true) {
  const [restored, setRestored] = React.useState<DraftEnvelope<T> | null>(null);

  // Read once per patientKey. Never re-read afterwards, or the form would
  // stomp its own state mid-edit.
  const readDraft = React.useCallback((): DraftEnvelope<T> | null => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(draftKey(patientKey));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as DraftEnvelope<T>;
      if (!parsed || typeof parsed !== "object" || !("data" in parsed)) return null;
      return parsed;
    } catch {
      return null;
    }
  }, [patientKey]);

  const writeDraft = React.useCallback(
    (data: T) => {
      if (typeof window === "undefined") return;
      try {
        window.localStorage.setItem(
          draftKey(patientKey),
          JSON.stringify({ savedAt: new Date().toISOString(), data } satisfies DraftEnvelope<T>),
        );
      } catch {
        /* quota exceeded / private mode: drafts are best-effort */
      }
    },
    [patientKey],
  );

  const clearDraft = React.useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(draftKey(patientKey));
    } catch {
      /* ignore */
    }
  }, [patientKey]);

  // Debounced auto-save.
  React.useEffect(() => {
    if (!enabled) return;
    const id = window.setTimeout(() => writeDraft(value), DRAFT_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [enabled, value, writeDraft]);

  return { readDraft, writeDraft, clearDraft, restored, setRestored };
}