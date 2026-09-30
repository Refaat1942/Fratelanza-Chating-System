import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetMe, getGetMeQueryKey, setAuthTokenGetter } from "@workspace/api-client-react";
import { resetSocket } from "@/hooks/use-socket";
import type { AppUser } from "@/lib/types";

interface AuthContextType {
  user: AppUser | null;
  isLoading: boolean;
  login: (token: string) => void;
  logout: (reason?: "expired") => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const [token, setToken] = useState<string | null>(() => {
    const saved = localStorage.getItem("lotus_token");
    if (saved) {
      setAuthTokenGetter(() => saved);
    }
    return saved;
  });

  const { data: user, isLoading, error } = useGetMe({
    query: {
      queryKey: getGetMeQueryKey(),
      enabled: !!token,
      retry: false,
    },
  });

  const login = (newToken: string) => {
    resetSocket();
    qc.clear();
    localStorage.setItem("lotus_token", newToken);
    setAuthTokenGetter(() => newToken);
    setToken(newToken);
  };

  const logout = useCallback((reason?: "expired") => {
    resetSocket();
    localStorage.removeItem("lotus_token");
    setToken(null);
    setAuthTokenGetter(() => null);
    qc.clear();
    window.location.href = reason === "expired" ? "/login?expired=1" : "/login";
  }, [qc]);

  useEffect(() => {
    if (error) logout("expired");
  }, [error, logout]);

  // Any API call answering 401 (token expired / account disabled) ends the session.
  useEffect(() => {
    const cache = qc.getQueryCache();
    const unsub = cache.subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "error") return;
      const status = (event.action.error as { status?: number } | null)?.status;
      if (status === 401 && localStorage.getItem("lotus_token")) logout("expired");
    });
    return unsub;
  }, [qc, logout]);

  return (
    <AuthContext.Provider
      value={{ user: (user as AppUser | undefined) || null, isLoading: !!token && isLoading, login, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
