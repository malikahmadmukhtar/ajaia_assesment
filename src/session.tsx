import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';
import type { User } from './shared/types';

interface Session { user: User | null; loading: boolean; setUser: (u: User | null) => void }
const Ctx = createContext<Session>({ user: null, loading: true, setUser: () => {} });
export const useSession = () => useContext(Ctx);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.me().then(setUser).catch(() => setUser(null)).finally(() => setLoading(false));
  }, []);
  return <Ctx.Provider value={{ user, loading, setUser }}>{children}</Ctx.Provider>;
}
