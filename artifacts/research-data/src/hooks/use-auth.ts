import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface AuthMe {
  authenticated: boolean;
  username: string | null;
  role: "admin" | "editor" | "viewer" | "user" | null;
  canAdminAccess: boolean;
}

// Fetch with a hard timeout so an unreachable backend (e.g. the Worker → tunnel
// → api-server chain is down) aborts instead of hanging the whole app on the
// auth gate. Without this, a pending /api/auth/me leaves `isLoading` true
// forever and the app shows an endless spinner.
async function fetchWithTimeout(url: string, init: RequestInit, ms = 10000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

async function fetchMe(): Promise<AuthMe> {
  const res = await fetchWithTimeout("/api/auth/me", { credentials: "include" });
  if (res.status === 401) return { authenticated: false, username: null, role: null, canAdminAccess: false };
  if (!res.ok) throw new Error("Failed to check auth");
  return res.json() as Promise<AuthMe>;
}

async function postLogin(username: string, password: string) {
  const res = await fetchWithTimeout("/api/auth/login", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error ?? "Login failed");
  }
  return res.json();
}

async function postLogout() {
  await fetchWithTimeout("/api/auth/logout", { method: "POST", credentials: "include" });
}

async function postSignup(payload: {
  username: string;
  password: string;
  fullName?: string;
  email?: string;
  reason?: string;
}) {
  const res = await fetchWithTimeout("/api/auth/signup", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error ?? "Sign-up failed");
  }
  return res.json();
}

async function postSignupOtpSend(username: string, email: string) {
  const res = await fetchWithTimeout("/api/auth/signup/otp/send", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, email }),
  });
  const body = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(body.error ?? "Could not send code");
  return body as { ok: boolean; sent?: boolean; emailMasked?: string };
}

async function postLoginOtpSend(username: string, loginToken: string) {
  const res = await fetchWithTimeout("/api/auth/login/otp/send", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, loginToken }),
  });
  const body = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(body.error ?? "Could not send code");
  return body as { ok: boolean; sent?: boolean; emailMasked?: string };
}

async function postSignupOtpVerify(username: string, email: string, code: string) {
  const res = await fetchWithTimeout("/api/auth/signup/otp/verify", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, email, code }),
  });
  const body = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(body.error ?? "Verification failed");
  return body as { ok: boolean; verified: boolean };
}

async function postLoginOtpVerify(username: string, loginToken: string, code: string) {
  const res = await fetchWithTimeout("/api/auth/login/otp/verify", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, loginToken, code }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error ?? "Verification failed");
  }
  return res.json();
}

export function useAuth() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["auth-me"],
    queryFn: fetchMe,
    retry: false,
    staleTime: 60_000,
  });

  const loginMutation = useMutation({
    mutationFn: ({ username, password }: { username: string; password: string }) =>
      postLogin(username, password),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auth-me"] }),
  });

  const logoutMutation = useMutation({
    mutationFn: postLogout,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auth-me"] }),
  });

  const signupMutation = useMutation({
    mutationFn: postSignup,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auth-me"] }),
  });

  const sendSignupOtpMutation = useMutation({
    mutationFn: ({ username, email }: { username: string; email: string }) =>
      postSignupOtpSend(username, email),
  });

  const verifySignupOtpMutation = useMutation({
    mutationFn: ({ username, email, code }: { username: string; email: string; code: string }) =>
      postSignupOtpVerify(username, email, code),
  });

  const sendLoginOtpMutation = useMutation({
    mutationFn: ({ username, loginToken }: { username: string; loginToken: string }) =>
      postLoginOtpSend(username, loginToken),
  });

  const verifyLoginOtpMutation = useMutation({
    mutationFn: ({
      username,
      loginToken,
      code,
    }: {
      username: string;
      loginToken: string;
      code: string;
    }) => postLoginOtpVerify(username, loginToken, code),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auth-me"] }),
  });

  return {
    isLoading,
    authenticated: data?.authenticated ?? false,
    username: data?.username ?? null,
    role: data?.role ?? null,
    canAdminAccess: data?.canAdminAccess ?? false,
    canEdit: data?.role ? data.role !== "viewer" : false,
    login: loginMutation.mutateAsync,
    loginError: loginMutation.error?.message ?? null,
    isLoggingIn: loginMutation.isPending,
    logout: logoutMutation.mutateAsync,
    signup: signupMutation.mutateAsync,
    signupError: signupMutation.error?.message ?? null,
    isSigningUp: signupMutation.isPending,
    sendSignupOtp: sendSignupOtpMutation.mutateAsync,
    sendSignupOtpError: sendSignupOtpMutation.error?.message ?? null,
    isSendingSignupOtp: sendSignupOtpMutation.isPending,
    verifySignupOtp: verifySignupOtpMutation.mutateAsync,
    verifySignupOtpError: verifySignupOtpMutation.error?.message ?? null,
    isVerifyingSignupOtp: verifySignupOtpMutation.isPending,
    // Login 2FA (OTP sent to the account email)
    sendLoginOtp: sendLoginOtpMutation.mutateAsync,
    sendLoginOtpError: sendLoginOtpMutation.error?.message ?? null,
    isSendingLoginOtp: sendLoginOtpMutation.isPending,
    verifyLoginOtp: verifyLoginOtpMutation.mutateAsync,
    verifyLoginOtpError: verifyLoginOtpMutation.error?.message ?? null,
    isVerifyingLoginOtp: verifyLoginOtpMutation.isPending,
  };
}
