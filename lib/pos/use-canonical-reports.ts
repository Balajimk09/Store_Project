'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  fetchCanonicalReportCoverage,
  fetchCanonicalReportSummary,
  getCanonicalReportSourceLabel,
  type CanonicalReportCoverage,
  type CanonicalReportSourceMode,
  type CanonicalReportSummary,
} from '@/lib/pos/canonical-reports';

interface UseCanonicalReportsParams {
  storeId: string | null;
  enabled: boolean;
  startBusinessDate: string;
  endBusinessDate: string;
  validDateRange: boolean;
}

export interface UseCanonicalReportsResult {
  coverage: CanonicalReportCoverage | null;
  summary: CanonicalReportSummary | null;
  sourceMode: CanonicalReportSourceMode;
  sourceLabel: string;
  legacyReason: 'historical' | 'upload' | null;
  loadingCoverage: boolean;
  loadingSummary: boolean;
  error: string | null;
  refresh: () => void;
  canonicalStartDate: string | null;
  canonicalLastObservedDate: string | null;
}

function decideSourceMode({
  enabled,
  validDateRange,
  coverage,
  startBusinessDate,
  endBusinessDate,
}: {
  enabled: boolean;
  validDateRange: boolean;
  coverage: CanonicalReportCoverage | null;
  startBusinessDate: string;
  endBusinessDate: string;
}): { mode: CanonicalReportSourceMode; legacyReason: 'historical' | 'upload' | null } {
  if (!enabled || !validDateRange || !coverage) return { mode: 'unavailable', legacyReason: null };
  if (!coverage.hasData || !coverage.firstBusinessDate) return { mode: 'legacy', legacyReason: 'upload' };
  if (!coverage.lastBusinessDate) return { mode: 'unavailable', legacyReason: null };
  if (endBusinessDate < coverage.firstBusinessDate) return { mode: 'legacy', legacyReason: 'historical' };
  if (startBusinessDate > coverage.lastBusinessDate) return { mode: 'unavailable', legacyReason: null };
  if (startBusinessDate >= coverage.firstBusinessDate && endBusinessDate <= coverage.lastBusinessDate) {
    return { mode: 'canonical', legacyReason: null };
  }
  return { mode: 'coverage_conflict', legacyReason: null };
}

export function useCanonicalReports({
  storeId,
  enabled,
  startBusinessDate,
  endBusinessDate,
  validDateRange,
}: UseCanonicalReportsParams): UseCanonicalReportsResult {
  const [coverage, setCoverage] = useState<CanonicalReportCoverage | null>(null);
  const [summary, setSummary] = useState<CanonicalReportSummary | null>(null);
  const [loadedSummaryKey, setLoadedSummaryKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingCoverage, setLoadingCoverage] = useState(false);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const mountedRef = useRef(false);
  const coverageRequestRef = useRef(0);
  const summaryRequestRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      coverageRequestRef.current += 1;
      summaryRequestRef.current += 1;
    };
  }, []);

  useEffect(() => {
    setCoverage(null);
    setSummary(null);
    setLoadedSummaryKey(null);
    setError(null);
    coverageRequestRef.current += 1;
    summaryRequestRef.current += 1;
  }, [enabled, storeId]);

  useEffect(() => {
    if (!enabled || !storeId) {
      setCoverage(null);
      setSummary(null);
      setError(null);
      setLoadingCoverage(false);
      return;
    }

    const requestId = coverageRequestRef.current + 1;
    coverageRequestRef.current = requestId;
    setLoadingCoverage(true);
    setError(null);

    fetchCanonicalReportCoverage(supabase, storeId)
      .then((result) => {
        if (!mountedRef.current || coverageRequestRef.current !== requestId) return;
        setCoverage(result);
      })
      .catch((loadError: unknown) => {
        if (!mountedRef.current || coverageRequestRef.current !== requestId) return;
        console.error('Failed to load canonical report coverage:', loadError);
        setCoverage(null);
        setSummary(null);
        setLoadedSummaryKey(null);
        setError('Canonical reporting coverage could not be loaded.');
      })
      .finally(() => {
        if (!mountedRef.current || coverageRequestRef.current !== requestId) return;
        setLoadingCoverage(false);
      });
  }, [enabled, refreshKey, storeId]);

  const decision = useMemo(
    () => decideSourceMode({
      enabled,
      validDateRange,
      coverage,
      startBusinessDate,
      endBusinessDate,
    }),
    [coverage, enabled, endBusinessDate, startBusinessDate, validDateRange]
  );

  const currentSummaryKey = useMemo(() => {
    if (decision.mode !== 'canonical' || !storeId || !validDateRange) return null;
    return `${storeId}:${startBusinessDate}:${endBusinessDate}:${refreshKey}`;
  }, [decision.mode, endBusinessDate, refreshKey, startBusinessDate, storeId, validDateRange]);

  useEffect(() => {
    setSummary(null);
    setLoadedSummaryKey(null);
    setError(null);
    summaryRequestRef.current += 1;

    if (!currentSummaryKey || !storeId || !validDateRange) {
      setLoadingSummary(false);
      return;
    }

    const requestId = summaryRequestRef.current + 1;
    summaryRequestRef.current = requestId;
    setLoadingSummary(true);

    fetchCanonicalReportSummary(supabase, {
      storeId,
      startBusinessDate,
      endBusinessDate,
    })
      .then((result) => {
        if (!mountedRef.current || summaryRequestRef.current !== requestId) return;
        setSummary(result);
        setLoadedSummaryKey(currentSummaryKey);
      })
      .catch((loadError: unknown) => {
        if (!mountedRef.current || summaryRequestRef.current !== requestId) return;
        console.error('Failed to load canonical report summary:', loadError);
        setSummary(null);
        setLoadedSummaryKey(null);
        setError('Canonical report summary could not be loaded.');
      })
      .finally(() => {
        if (!mountedRef.current || summaryRequestRef.current !== requestId) return;
        setLoadingSummary(false);
      });
  }, [currentSummaryKey, endBusinessDate, startBusinessDate, storeId, validDateRange, refreshKey]);

  const refresh = useCallback(() => {
    setRefreshKey((value) => value + 1);
  }, []);

  return {
    coverage,
    summary: currentSummaryKey && loadedSummaryKey === currentSummaryKey ? summary : null,
    sourceMode: decision.mode,
    sourceLabel: getCanonicalReportSourceLabel(decision.mode, decision.legacyReason ?? undefined),
    legacyReason: decision.legacyReason,
    loadingCoverage,
    loadingSummary,
    error,
    refresh,
    canonicalStartDate: coverage?.firstBusinessDate ?? null,
    canonicalLastObservedDate: coverage?.lastBusinessDate ?? null,
  };
}
