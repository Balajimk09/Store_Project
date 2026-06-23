'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

type AppPermission = {
  permission_key: string;
  can_delegate: boolean;
};

type AppMeResponse = {
  user: {
    id: string;
    email?: string;
  };
  profile: Record<string, unknown> | null;
  permissions: AppPermission[];
  permissionKeys: string[];
  isSuperadmin: boolean;
};

type PermissionState = {
  loading: boolean;
  error: string | null;
  user: AppMeResponse['user'] | null;
  profile: AppMeResponse['profile'];
  permissions: AppPermission[];
  permissionKeys: string[];
  isSuperadmin: boolean;
};

export function usePermissions() {
  const [state, setState] = useState<PermissionState>({
    loading: true,
    error: null,
    user: null,
    profile: null,
    permissions: [],
    permissionKeys: [],
    isSuperadmin: false,
  });

  const loadPermissions = useCallback(async () => {
    setState((current) => ({
      ...current,
      loading: true,
      error: null,
    }));

    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;

      if (!token) {
        setState({
          loading: false,
          error: null,
          user: null,
          profile: null,
          permissions: [],
          permissionKeys: [],
          isSuperadmin: false,
        });
        return;
      }

      const response = await fetch('/api/app/me', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const json = await response.json();

      if (!response.ok) {
        throw new Error(json.error || 'Could not load permissions.');
      }

      const payload = json as AppMeResponse;

      setState({
        loading: false,
        error: null,
        user: payload.user,
        profile: payload.profile,
        permissions: payload.permissions || [],
        permissionKeys: payload.permissionKeys || [],
        isSuperadmin: payload.isSuperadmin === true,
      });
    } catch (error) {
      setState({
        loading: false,
        error: error instanceof Error ? error.message : 'Could not load permissions.',
        user: null,
        profile: null,
        permissions: [],
        permissionKeys: [],
        isSuperadmin: false,
      });
    }
  }, []);

  useEffect(() => {
    loadPermissions();
  }, [loadPermissions]);

  const permissionSet = useMemo(
    () => new Set(state.permissionKeys),
    [state.permissionKeys]
  );

  const hasPermission = useCallback(
    (permissionKey: string) => {
      if (state.isSuperadmin) return true;
      return permissionSet.has(permissionKey);
    },
    [permissionSet, state.isSuperadmin]
  );

  const hasAnyPermission = useCallback(
    (permissionKeys: string[]) => {
      if (state.isSuperadmin) return true;
      return permissionKeys.some((permissionKey) => permissionSet.has(permissionKey));
    },
    [permissionSet, state.isSuperadmin]
  );

  return {
    ...state,
    hasPermission,
    hasAnyPermission,
    refreshPermissions: loadPermissions,
  };
}