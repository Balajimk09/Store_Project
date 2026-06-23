import { supabase } from '@/lib/supabase';

export type AdminMeResponse = {
  user: {
    id: string;
    email?: string;
  };
  profile: Record<string, unknown> | null;
  permissions: Array<{
    permission_key: string;
    can_delegate: boolean;
  }>;
  permissionKeys: string[];
  isSuperadmin: boolean;
};

export async function adminFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    throw new Error('Please log in again.');
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options?.headers || {}),
    },
  });

  const json = await response.json();

  if (!response.ok) {
    throw new Error(json.error || 'Request failed.');
  }

  return json as T;
}

export async function fetchAdminMe(): Promise<AdminMeResponse> {
  return adminFetch<AdminMeResponse>('/api/admin/me');
}
