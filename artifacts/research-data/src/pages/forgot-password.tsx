import AuthPage from "@/pages/auth";

/**
 * `/forgot-password` entry point.
 *
 * A password that cannot be recovered is a permanent lockout, so this route
 * exists as a first-class destination rather than a modal inside `/login`:
 * it is linkable ("forgot your password? email this link"), bookmarkable, and
 * deep-linkable from a support reply.
 *
 * The neutral confirmation is the security property of the flow — the page
 * must never reveal whether the account exists — so it lives with the other
 * copy in `@/pages/auth`, where the copy and the wording are reviewable
 * together.
 */
export default function ForgotPassword() {
  return <AuthPage initialMode="forgot" />;
}
