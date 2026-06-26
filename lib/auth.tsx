'use client';

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, type StoreRow } from '@/lib/supabase';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  store: StoreRow | null;
  stores: StoreRow[];
  activeStore: StoreRow | null;
  activeStoreId: string | null;
  storeScope: 'single' | 'all';
  storeLoading: boolean;
  setActiveStoreId: (id: string | null) => void;
  refreshStores: () => Promise<void>;
  refreshStore: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  user: null,
  loading: true,
  store: null,
  stores: [],
  activeStore: null,
  activeStoreId: null,
  storeScope: 'single',
  storeLoading: false,
  setActiveStoreId: () => {},
  refreshStores: async () => {},
  refreshStore: async () => {},
  signOut: async () => {},
});

const ACTIVE_STORE_KEY = 'storepulse_active_store_id';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [activeStoreId, setActiveStoreIdState] = useState<string | null>(null);
  const [storeLoading, setStoreLoading] = useState(false);

  const setActiveStoreId = useCallback((id: string | null) => {
    setActiveStoreIdState(id);
    try {
      if (id) {
        localStorage.setItem(ACTIVE_STORE_KEY, id);
      } else {
        localStorage.setItem(ACTIVE_STORE_KEY, 'all');
      }
    } catch {
      // localStorage is unavailable during some browser privacy modes.
    }
  }, []);

  const refreshStores = useCallback(async () => {
    const { data: { session: s } } = await supabase.auth.getSession();
    if (!s) {
      setStores([]);
      setActiveStoreIdState(null);
      return;
    }
    setStoreLoading(true);
    const { data, error } = await supabase
      .from('stores')
      .select('*')
      .eq('owner_id', s.user.id)
      .order('created_at', { ascending: true });
    if (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to load stores:', error.message);
    }
    const ownedStores = ((data || []) as StoreRow[]);
    setStores(ownedStores);

    setActiveStoreIdState((current) => {
      let saved: string | null = null;
      try {
        saved = localStorage.getItem(ACTIVE_STORE_KEY);
      } catch {
        saved = null;
      }

      if (saved === 'all') return null;
      if (current && ownedStores.some((ownedStore) => ownedStore.id === current)) return current;
      if (saved && ownedStores.some((ownedStore) => ownedStore.id === saved)) return saved;
      return ownedStores[0]?.id || null;
    });
    setStoreLoading(false);
  }, []);

  const refreshStore = refreshStores;

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      if (!mounted) return;
      setSession(s);
      setLoading(false);
      if (s) {
        refreshStores();
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      // Wrap async work to avoid deadlock inside the synchronous callback
      (async () => {
        setSession(s);
        setLoading(false);
        if (s) {
          await refreshStores();
        } else {
          setStores([]);
          setActiveStoreIdState(null);
        }
      })();
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [refreshStores]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setStores([]);
    setActiveStoreIdState(null);
    setSession(null);
  }, []);

  const activeStore = stores.find((ownedStore) => ownedStore.id === activeStoreId) || null;
  const storeScope = activeStoreId === null && stores.length > 0 ? 'all' : 'single';
  const store = activeStore;

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        loading,
        store,
        stores,
        activeStore,
        activeStoreId,
        storeScope,
        storeLoading,
        setActiveStoreId,
        refreshStores,
        refreshStore,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
