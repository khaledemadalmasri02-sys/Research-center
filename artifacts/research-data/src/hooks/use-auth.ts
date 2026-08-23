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
  };
}
