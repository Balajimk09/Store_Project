'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  CANONICAL_TRANSACTION_PAGE_SIZE,
  fetchCanonicalAvailability,
  fetchCanonicalTransactionPage,
  type CanonicalTransactionFilters,
  type CanonicalTransactionPageResult,
} from '@/lib/pos/canonical-transactions';

export interface UseCanonicalTransactionsResult {
  data: CanonicalTransactionPageResult | null;
  error: string | null;
  canonicalAvailable: boolean | null;
  canonicalFilteredCount: number;
  loading: boolean;
  refreshing: boolean;
  lastRefreshedAt: string | null;
  refresh: () => Promise<void>;
}

function formatLoadError(error: unknown): string {
  // Full details are logged for development, but store users get a stable, non-SQL message.
  console.error('Failed to load canonical POS transactions:', error);
  return 'Live POS data could not be loaded.';
}

export function useCanonicalTransactions({
  storeId,
  enabled,
  page,
  filters,
  timeZone,
}: {
  storeId: string | null;
  enabled: boolean;
  page: number;
  filters: CanonicalTransactionFilters;
  timeZone: string;
}): UseCanonicalTransactionsResult {
  const [data, setData] = useState<CanonicalTransactionPageResult | null>(null);
  const [dataKey, setDataKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canonicalAvailable, setCanonicalAvailable] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const requestRef = useRef(0);
  const hasDataRef = useRef(false);
  const mountedRef = useRef(false);

  const stableFilters = useMemo(() => filters, [filters]);
  const requestKey = JSON.stringify({ enabled, storeId, page, stableFilters, timeZone });
  const latestRequestKeyRef = useRef(requestKey);
  latestRequestKeyRef.current = requestKey;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
    };
  }, []);

  useEffect(() => {
    setData(null);
    setDataKey(null);
    setError(null);
    setCanonicalAvailable(null);
    setLastRefreshedAt(null);
    hasDataRef.current = false;
    requestRef.current += 1;
  }, [enabled, storeId]);

  const load = useCallback(
    async (background = false) => {
      if (!enabled || !storeId) {
        setData(null);
        setDataKey(null);
        setError(null);
        setCanonicalAvailable(null);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      const requestId = requestRef.current + 1;
      requestRef.current = requestId;
      const loadKey = latestRequestKeyRef.current;

      if (background || hasDataRef.current) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const available = await fetchCanonicalAvailability(supabase, storeId);
        const result = available
          ? await fetchCanonicalTransactionPage(supabase, {
              storeId,
              page,
              pageSize: CANONICAL_TRANSACTION_PAGE_SIZE,
              filters: stableFilters,
              timeZone,
            })
          : null;

        if (!mountedRef.current || requestRef.current !== requestId || latestRequestKeyRef.current !== loadKey) return;
        setData(result);
        setDataKey(loadKey);
        setCanonicalAvailable(available);
        hasDataRef.current = true;
        setError(null);
        setLastRefreshedAt(new Date().toISOString());
      } catch (loadError) {
        if (!mountedRef.current || requestRef.current !== requestId || latestRequestKeyRef.current !== loadKey) return;
        setError(formatLoadError(loadError));
      } finally {
        if (mountedRef.current && requestRef.current === requestId && latestRequestKeyRef.current === loadKey) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [enabled, page, stableFilters, storeId, timeZone]
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    if (!enabled || !storeId) return undefined;
    const interval = window.setInterval(() => {
      void load(true);
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [enabled, load, storeId]);

  const visibleData = dataKey === requestKey ? data : null;

  return {
    data: visibleData,
    error,
    canonicalAvailable,
    canonicalFilteredCount: visibleData?.totalHeaders ?? 0,
    loading,
    refreshing,
    lastRefreshedAt,
    refresh: () => load(true),
  };
}
