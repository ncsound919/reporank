import { createContext, useContext, useEffect, useState } from "react";
import { api, type UserProfile } from "../api/client";

interface AuthState {
  user: UserProfile | null;
  loading: boolean;
  login: () => void;
  logout: () => void;
}

// Set VITE_GITHUB_CLIENT_ID in apps/web/.env or replace below
const GITHUB_CLIENT_ID = "your-github-client-id";
const REDIRECT_URI = `${window.location.origin}/auth/callback`;

const AuthContext = createContext<AuthState>({
  user: null, loading: true,
  login: () => {}, logout: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("reporank_token");
    if (token) {
      api.auth.me().then(setUser).catch(() => { localStorage.removeItem("reporank_token"); }).finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = () => {
    const state = crypto.randomUUID();
    localStorage.setItem("reporank_oauth_state", state);
    window.location.href = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${REDIRECT_URI}&state=${state}&scope=read:user`;
  };

  const logout = () => {
    localStorage.removeItem("reporank_token");
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
