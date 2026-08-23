import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { apiGet, apiPost } from "../lib/api";

export interface AuthUser {
  id: number;
  username: string;
  fullName?: string | null;
  email?: string | null;
  role: string;
  canAdminAccess: boolean;
  status: string;
}

interface AuthValue {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthValue>({
  user: null,
  loading: true,
  login: async () => {},
  logout: async () => {},
  refresh: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const r = await apiGet<{ authenticated: boolean } & AuthUser>("/api/auth/me");
      setUser(r.authenticated ? r : null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = async (username: string, password: string) => {
    await apiPost("/api/auth/login", { username, password });
    await refresh();
  };
  const logout = async () => {
    try {
      await apiPost("/api/auth/logout");
    } catch {}
    setUser(null);
  };

  return <Ctx.Provider value={{ user, loading, login, logout, refresh }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
export const canEdit = (u: AuthUser | null) =>
  !!u && (u.canAdminAccess || u.role === "editor" || u.role === "admin");
export const canAdmin = (u: AuthUser | null) => !!u?.canAdminAccess;
