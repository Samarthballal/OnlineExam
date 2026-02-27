import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api from '../services/api';

const STORAGE_KEY = 'exam-pilot-auth';
const AuthContext = createContext(null);

function readInitialAuth() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    return { token: null, user: null };
  }

  try {
    return JSON.parse(stored);
  } catch (error) {
    localStorage.removeItem(STORAGE_KEY);
    return { token: null, user: null };
  }
}

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(readInitialAuth);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    if (auth.token) {
      api.defaults.headers.common.Authorization = `Bearer ${auth.token}`;
    } else {
      delete api.defaults.headers.common.Authorization;
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
  }, [auth]);

  useEffect(() => {
    const init = async () => {
      if (!auth.token) {
        setInitializing(false);
        return;
      }

      try {
        const response = await api.get('/auth/me');
        setAuth((prev) => ({ ...prev, user: response.data.user }));
      } catch (error) {
        setAuth({ token: null, user: null });
      } finally {
        setInitializing(false);
      }
    };

    init();
  }, []);

  const login = useCallback(async (email, password) => {
    const response = await api.post('/auth/login', { email, password });
    setAuth({ token: response.data.token, user: response.data.user });
    return response.data.user;
  }, []);

  const register = useCallback(async (payload) => {
    const response = await api.post('/auth/register', payload);
    setAuth({ token: response.data.token, user: response.data.user });
    return response.data.user;
  }, []);

  const logout = useCallback(() => {
    setAuth({ token: null, user: null });
  }, []);

  const value = useMemo(
    () => ({
      user: auth.user,
      token: auth.token,
      initializing,
      login,
      register,
      logout,
    }),
    [auth.user, auth.token, initializing, login, register, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
