import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { AuthState, SessionSnapshot } from '@/domain/types';
import { errorMessage } from '@/domain/errors';
import type { DemoIdentity } from '@/data/repository';
import { useRepository } from './RepositoryContext';

interface AuthContextValue {
  state: AuthState;
  session: SessionSnapshot | null;
  loading: boolean;
  error: string | null;
  demoIdentities: DemoIdentity[];
  refresh: () => Promise<void>;
  signInDemo: (userId: string) => Promise<void>;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<{ needsEmailConfirmation: boolean }>;
  signOut: () => Promise<void>;
  acceptInvite: (token: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const repo = useRepository();
  const [state, setState] = useState<AuthState>({
    status: 'loading',
    user: null,
    backend: repo.kind,
    isDemo: repo.isDemo,
  });
  const [session, setSession] = useState<SessionSnapshot | null>(null);
  const [demoIdentities, setDemoIdentities] = useState<DemoIdentity[]>([]);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      const next = await repo.auth.getState();
      if (!mounted.current) return;
      setState(next);
      if (next.status === 'authenticated') {
        const snapshot = await repo.getSession();
        if (mounted.current) setSession(snapshot);
      } else {
        setSession(null);
      }
      setError(null);
      if (repo.auth.listDemoIdentities) {
        const identities = await repo.auth.listDemoIdentities();
        if (mounted.current) setDemoIdentities(identities);
      }
    } catch (loadError) {
      if (mounted.current) setError(errorMessage(loadError, '无法读取登录状态。'));
    }
  }, [repo]);

  useEffect(() => {
    mounted.current = true;
    void load();
    const unsubscribe = repo.auth.subscribe(() => {
      void load();
    });
    return () => {
      mounted.current = false;
      unsubscribe();
    };
  }, [repo, load]);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      session,
      loading: state.status === 'loading',
      error,
      demoIdentities,
      refresh: load,
      signInDemo: async (userId) => {
        if (!repo.auth.signInDemo) throw new Error('当前后端不支持演示登录。');
        await repo.auth.signInDemo(userId);
        await load();
      },
      signInWithPassword: async (email, password) => {
        await repo.auth.signInWithPassword(email, password);
        await load();
      },
      signUp: async (email, password, displayName) => {
        const result = await repo.auth.signUp(email, password, displayName);
        await load();
        return result;
      },
      signOut: async () => {
        await repo.auth.signOut();
        await load();
      },
      acceptInvite: async (token) => {
        await repo.auth.acceptInvite({ token });
        await load();
      },
    }),
    [state, session, error, demoIdentities, load, repo],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
