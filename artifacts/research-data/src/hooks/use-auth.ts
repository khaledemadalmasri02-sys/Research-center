import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

async function fetchMe() {
  const res = await fetch("/api/auth/me", { credentials: "include" });
  if (res.status === 401) return { authenticated: false, username: null };
  if (!res.ok) throw new Error("Failed to check auth");
  return res.json() as Promise<{ authenticated: boolean; username: string }>;
}

async function postLogin(username: string, password: string) {
  const res = await fetch("/api/auth/login", {
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
  await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
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

  return {
    isLoading,
    authenticated: data?.authenticated ?? false,
    username: data?.username ?? null,
    login: loginMutation.mutateAsync,
    loginError: loginMutation.error?.message ?? null,
    isLoggingIn: loginMutation.isPending,
    logout: logoutMutation.mutateAsync,
  };
}
