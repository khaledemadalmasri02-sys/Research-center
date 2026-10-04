import { useState } from "react";
import { useSearch } from "wouter";
import { Loader2 } from "lucide-react";

import { resolveAuthError, type AuthErrorResponse } from "@/lib/auth-errors";
import { useAuthTranslate } from "@/components/auth/use-translate";

type Provider = "google" | "apple";

const PROVIDER_LABEL: Record<Provider, string> = {
  google: "Google",
  apple: "Apple",
};

/**
 * Federated sign-in.
 *
 * OAuth is a full-page navigation, so there is no `catch` to hang an error off:
 * the backend bounces back to `/login?oauth=error` (and, per the contract, a
 * `code`). Two distinct failures need two different messages —
 * `AUTH_OAUTH_LINK_REQUIRED` means "this provider is not on your account, sign
 * in with your password and link it", which is a completely different next
 * step from a cancelled popup — and the previous single hardcoded sentence
 * covered neither, in any language.
 *
 * Double-submit: while one provider is redirecting, the other is disabled too.
 * `window.location.assign` does not stop React from handling the second click,
 * and two parallel OAuth flows produce a confusing `state` mismatch on return.
 */
export function SocialProviders() {
  const search = useSearch();
  const { t } = useAuthTranslate();
  const [loading, setLoading] = useState<Provider | null>(null);

  const params = new URLSearchParams(search);
  const oauthFailed = params.get("oauth") === "error";
  const oauthCode = params.get("code");

  const oauthError = oauthFailed
    ? resolveAuthError(
        { code: oauthCode, error: params.get("error_message") } as AuthErrorResponse,
        t,
      )
    : null;

  function start(provider: Provider) {
    if (loading) return;
    setLoading(provider);
    window.location.assign(`/api/auth/oauth/${provider}`);
  }

  return (
    <div className="mt-6 space-y-3">
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-white/15" />
        </div>
        <div className="relative -mt-2.5 flex justify-center">
          <span className="px-3 text-xs uppercase tracking-[0.2em] text-white/75">
            {t("auth.oauthDivider", "Or continue with")}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <ProviderButton
          provider="google"
          loading={loading === "google"}
          disabled={loading !== null && loading !== "google"}
          onClick={start}
        />
        <ProviderButton
          provider="apple"
          loading={loading === "apple"}
          disabled={loading !== null && loading !== "apple"}
          onClick={start}
        />
      </div>

      {oauthError ? (
        <p
          // Assertive: the user has just come back from a redirect and the
          // whole reason they are still on this screen is that it failed.
          role="alert"
          aria-live="assertive"
          data-testid="oauth-error"
          className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200"
        >
          {oauthError.message}
        </p>
      ) : null}
    </div>
  );
}

function ProviderButton({
  provider,
  loading,
  disabled,
  onClick,
}: {
  provider: Provider;
  loading: boolean;
  disabled: boolean;
  onClick: (provider: Provider) => void;
}) {
  const { t } = useAuthTranslate();
  const Icon = provider === "google" ? GoogleIcon : AppleIcon;

  return (
    <button
      type="button"
      aria-label={t("auth.oauthSignInWith", "Sign in with {{provider}}", {
        provider: PROVIDER_LABEL[provider],
      })}
      aria-busy={loading || undefined}
      data-provider={provider}
      className="auth-provider-button relative flex h-12 w-full items-center justify-center rounded-xl border border-white/20 p-0 transition-all hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#101316] active:translate-y-0 disabled:pointer-events-none disabled:opacity-50"
      disabled={disabled}
      onClick={() => onClick(provider)}
    >
      <span
        className={
          "flex h-10 w-10 items-center justify-center rounded-lg " +
          (provider === "google" ? "bg-white text-black" : "bg-black text-white")
        }
      >
        {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Icon />}
      </span>
    </button>
  );
}

function GoogleIcon() {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 24 24"
      role="img"
      aria-label="Google"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fill="#4285F4"
        d="M22.56 12.13c0-.61-.06-1.21-.16-1.79H12v3.37h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.94 3.28-4.78 3.28-8.12z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.87 0 5.28-.93 7.11-2.53l-.01-.02c-1.98-1.49-4.55-2.39-7.11-2.39-5.52 0-10.18 4.19-10.18 9.62 0 2.35 1.14 4.43 2.86 5.79l-.02.01z"
      />
      <path
        fill="#FBBC05"
        d="M5.43 14.53c-.33-.98-.51-2.02-.51-3.11 0-1.08.19-2.12.51-3.1L3.21 5.76C2.43 7.55 2 9.62 2 11.42c0 1.8.42 3.48 1.15 4.92l-.02-.02z"
      />
      <path
        fill="#EA4335"
        d="M17.33 10.59c-.47-.43-1.02-.79-1.64-1.07v2.14h3.37c-.17-.72-.67-1.34-1.3-1.76l-.43-.31z"
      />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg
      width="30"
      height="30"
      viewBox="0 0 384 512"
      fill="currentColor"
      role="img"
      aria-label="Apple"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
    </svg>
  );
}
