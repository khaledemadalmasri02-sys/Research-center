/**
 * Public surface of the MFA component family.
 *
 * `auth.tsx` should import from here (`@/components/auth/mfa`) rather than
 * reaching into individual files, so the internal layout can move without
 * touching the login page.
 *
 * `RecoveryCodeEntry` is the one export another agent needs: it is the
 * "use a recovery code instead" affordance for the login 2FA step, and its
 * mounting instructions are documented at the top of
 * `./recovery-code-entry.tsx`.
 */
export { EnrollmentMediaSlot, MFA_QR_ALT, type QrImage } from "./enrollment-media-slot";
export {
  CopyButton,
  CopyField,
  copyText,
  groupSecret,
  useCopy,
  COPY_FEEDBACK_MS,
  type CopyImpl,
  type CopyResult,
  type CopyState,
} from "./copy-field";
export {
  TotpCodeInput,
  isCodeComplete,
  joinCode,
  TOTP_LENGTH,
  type TotpCodeInputProps,
} from "./totp-code-input";
export {
  RecoveryCodesPanel,
  RecoveryCodesLeaveGuard,
  buildRecoveryCodesFile,
  downloadTextFile,
} from "./recovery-codes";
export { useBlockLeave, LeaveGuardDialog } from "./use-block-leave";
export {
  AuthErrorBanner,
  RateLimitNotice,
  formatCountdown,
  useCountdown,
} from "./feedback";
export { PasswordReauthForm, type PasswordReauthFormProps } from "./password-reauth-form";
export {
  RecoveryCodeEntry,
  normaliseRecoveryCode,
  formatRecoveryCode,
  type RecoveryCodeEntryProps,
} from "./recovery-code-entry";
export {
  AuthApiError,
  isAuthApiError,
  presentAuthError,
  authErrorFromResponse,
  needsReauth,
  isDeadSession,
  DEFAULT_RETRY_AFTER_SEC,
  type AuthErrorCode,
  type AuthErrorPresentation,
  type AuthErrorSeverity,
} from "./errors";
export {
  confirmEnrollment,
  disableMfa,
  fetchMfaStatus,
  reauthenticate,
  redeemRecoveryCode,
  regenerateRecoveryCodes,
  startEnrollment,
  type EnrollmentSecret,
  type MfaStatus,
} from "./api";