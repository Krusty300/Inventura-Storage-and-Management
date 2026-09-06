import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import queryClient from "../api/queryClient";
import api from "../api/client";
import { canUser } from "../utils/permissions";
import type { User } from "../types";

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (username: string, password: string, remember?: boolean) => Promise<void>;
  register: (username: string, email: string, password: string, role?: string) => Promise<{ pending?: boolean }>;
  logout: () => void;
  completeLogout: () => void;
  updateUser: (updates: Partial<User>) => void;
  loading: boolean;
  loggingOut: boolean;
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    const t = localStorage.getItem("token");
    const u = localStorage.getItem("user");
    if (t && u) {
      try {
        const parsed = JSON.parse(u);
        if (parsed && typeof parsed === "object" && typeof parsed.username === "string" && parsed.id != null) {
          setToken(t);
          setUser(parsed);
        } else {
          localStorage.removeItem("token");
          localStorage.removeItem("user");
        }
      } catch {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
      }
    }
    setLoading(false);
    setLoggingOut(false);

    if (t) {
      let cancelled = false;
      api
        .get("/auth/me")
        .then(({ data }) => {
          if (cancelled) return;
          if (data && typeof data === "object" && typeof data.username === "string" && data.id != null) {
            setUser(data);
            localStorage.setItem("user", JSON.stringify(data));
          }
        })
        .catch(() => {
          // 401 invalid-token is handled by the global axios interceptor
          // (clears token + redirects to /login); transient network failures
          // must not sign the user out.
        });
      return () => {
        cancelled = true;
      };
    }
  }, []);

  const login = async (username: string, password: string, remember = false) => {
    setLoggingOut(false);
    const { data } = await api.post("/auth/login", { username, password, remember });
    localStorage.setItem("token", data.access_token);
    localStorage.setItem("user", JSON.stringify(data.user));
    setToken(data.access_token);
    setUser(data.user);
  };

  const register = async (username: string, email: string, password: string, role = "worker"): Promise<{ pending?: boolean }> => {
    setLoggingOut(false);
    const resp = await api.post("/auth/register", { username, email, password, role });
    if (resp.status === 201 || resp.data?.message) {
      return { pending: true };
    }
    const data = resp.data;
    localStorage.setItem("token", data.access_token);
    localStorage.setItem("user", JSON.stringify(data.user));
    setToken(data.access_token);
    setUser(data.user);
    return {};
  };

  const logout = () => {
    setLoggingOut(true);
    api.post("/auth/logout").catch(() => {});
  };

  const completeLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    queryClient.clear();
    setToken(null);
    setUser(null);
    setLoggingOut(false);
  };

  const updateUser = (updates: Partial<User>) => {
    setUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...updates };
      localStorage.setItem("user", JSON.stringify(next));
      return next;
    });
  };

  const can = (permission: string) => canUser(user, permission);

  return (
    <AuthContext.Provider value={{ user, token, login, register, logout, completeLogout, updateUser, loading, loggingOut, can }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
