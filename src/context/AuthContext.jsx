import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api, { tokenStore } from '../services/api';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [access, setAccess] = useState(null);
  const [loading, setLoading] = useState(!!tokenStore.get());

  const apply = useCallback((data) => { setUser(data.user); setAccess(data.access); }, []);
  const logout = useCallback(() => { tokenStore.clear(); setUser(null); setAccess(null); }, []);

  const refresh = useCallback(async () => {
    try { const { data } = await api.get('/auth/me'); apply(data); } catch { logout(); }
  }, [apply, logout]);

  useEffect(() => {
    if (tokenStore.get()) refresh().finally(() => setLoading(false));
    const onExpired = () => logout();
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, [refresh, logout]);

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    tokenStore.set(data.token); apply(data); return data;
  };
  const register = async (payload) => {
    const { data } = await api.post('/auth/register', payload);
    tokenStore.set(data.token); apply(data); return data;
  };

  const value = useMemo(() => {
    const role = user?.role;
    return {
      user, access, loading, login, register, logout, refresh, setUser,
      role,
      isAdmin: role === 'SUPER_ADMIN',
      isIndividual: role === 'INDIVIDUAL',
      isOwner: role === 'ORGANIZATION_OWNER',
      isMember: role === 'ORGANIZATION_MEMBER',
      isOrg: role === 'ORGANIZATION_OWNER' || role === 'ORGANIZATION_MEMBER',
      canWrite: !!access?.canWrite, // UI hint only - the server enforces this
    };
    // eslint-disable-next-line
  }, [user, access, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
