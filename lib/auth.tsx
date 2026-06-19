'use client';

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, type StoreRow } from '@/lib/supabase';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  store: StoreRow | null;
  storeLoading: boolean;
  refreshStore: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  user: null,
  loading: true,
  store: null,
  storeLoading: false,
  refreshStore: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [store, setStore] = useState<StoreRow | null>(null);
  const [storeLoading, setStoreLoading] = useState(false);

  const refreshStore = useCallback(async () => {
    const { data: { session: s } } = await supabase.auth.getSession();
    if (!s) {
      setStore(null);
      return;
    }
    setStoreLoading(true);
    const { data, error } = await supabase
      .from('stores')
      .select('*')
      .eq('owner_id', s.user.id)
      .maybeSingle();
    if (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to load store:', error.message);
    }
    setStore((data as StoreRow | null) ?? null);
    setStoreLoading(false);
  }, []);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      if (!mounted) return;
      setSession(s);
      setLoading(false);
      if (s) {
        refreshStore();
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      // Wrap async work to avoid deadlock inside the synchronous callback
      (async () => {
        setSession(s);
        setLoading(false);
        if (s) {
          await refreshStore();
        } else {
          setStore(null);
        }
      })();
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [refreshStore]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setStore(null);
    setSession(null);
  }, []);

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading, store, storeLoading, refreshStore, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
