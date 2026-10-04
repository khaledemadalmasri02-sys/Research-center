import AuthPage from "@/pages/auth";

/**
 * `/reset-password` entry point — the target of the link in the reset email.
 *
 * Deep-linkable as `/reset-password?token=…`; the token is read from the URL
 * by `AuthPage`, which is also why this route has to be PUBLIC (outside the
 * authenticated branch in `App.tsx`): the user clicking the link is, by
 * definition, signed out.
 *
 * A link that arrives without a token, or whose token has expired / been
 * used / been tampered with, gets its own state and its own copy — an expired
 * link is the single most common outcome of this flow, not an edge case.
 */
export default function ResetPassword() {
  return <AuthPage initialMode="reset" />;
}
