import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  clearAuthState,
  getStoredToken,
  getStoredUser,
  persistAuthState,
  requestApi as rawRequestApi,
} from "./api/client";

const AuthContext = createContext({});

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => getStoredToken());
  const [user, setUser] = useState(() => getStoredUser());
  const [initializing, setInitializing] = useState(true);
  const isAuthenticated = Boolean(token && user);

  useEffect(() => {
    async function fetchProfile() {
      if (!token) {
        setInitializing(false);
        return;
      }

      try {
        const { payload } = await rawRequestApi("/auth/me");
        setUser(payload.user);
      } catch (error) {
        clearAuthState();
        setUser(null);
        setToken("");
      } finally {
        setInitializing(false);
      }
    }

    fetchProfile();
  }, [token]);

  const login = async (username, password) => {
    const { payload } = await rawRequestApi("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    setToken(payload.token);
    setUser(payload.user);
    persistAuthState(payload.token, payload.user);
    return payload.user;
  };

  const register = async (username, password) => {
    const { payload } = await rawRequestApi("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    setToken(payload.token);
    setUser(payload.user);
    persistAuthState(payload.token, payload.user);
    return payload.user;
  };

  const logout = () => {
    clearAuthState();
    setToken("");
    setUser(null);
  };

  const value = useMemo(
    () => ({ token, user, login, register, logout, initializing, isAuthenticated }),
    [token, user, initializing, isAuthenticated],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
