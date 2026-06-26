import { supabase } from '@/lib/supabase';

export type AdminMeResponse = {
  profile: {
    userId: string;
    email: string | null;
    fullName: string | null;
    status: string | null;
    isCompanyStaff: boolean;
    isSupportAgent: boolean;
    departmentName: string | null;
    roleName: string | null;
    roleCode: string | null;
    supportAccess: boolean;
  };
  user: {
    id: string;
    email?: string;
  };
  permissions: string[];
  permissionKeys: string[];
  isSuperadmin: boolean;
  isCompanyStaff: boolean;
  supportAccess: {
    isActive: boolean;
    roleCode: string | null;
    permissions: string[];
  };
  roleCode: string | null;
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
