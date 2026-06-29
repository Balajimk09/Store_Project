import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';

type CookieResponse = NextResponse<unknown>;

const INACTIVE_STAFF_STATUSES = new Set(['inactive', 'suspended', 'disabled', 'removed']);
const PUBLIC_AUTH_PATHS = new Set([
  '/login',
  '/signup',
  '/admin/login',
  '/admin/forgot-password',
  '/superadmin/login',
  '/superadmin/forgot-password',
  '/forgot-password',
  '/reset-password',
]);

function normalizePathname(pathname: string) {
  const trimmedPathname = pathname !== '/' ? pathname.replace(/\/+$/, '') : pathname;
  return trimmedPathname.toLowerCase();
}

function copyCookies(from: CookieResponse, to: CookieResponse) {
  from.cookies.getAll().forEach((cookie) => {
    to.cookies.set(cookie);
  });
}

function redirectWithCookies(request: NextRequest, response: CookieResponse, pathname: string) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = '';
  const redirectResponse = NextResponse.redirect(url);
  copyCookies(response, redirectResponse);
  return redirectResponse;
}

function loginRedirect(
  request: NextRequest,
  response: CookieResponse,
  reason: 'unauthenticated' | 'unauthorized' | 'disabled',
  includeRedirect: boolean
) {
  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.searchParams.set('reason', reason);

  if (includeRedirect) {
    url.searchParams.set('redirect', `${request.nextUrl.pathname}${request.nextUrl.search}`);
  }

  const redirectResponse = NextResponse.redirect(url);
  copyCookies(response, redirectResponse);
  return redirectResponse;
}

async function hasSuperadminPermission(supabase: ReturnType<typeof createServerClient>, userId: string) {
  const { data, error } = await supabase
    .from('user_permissions')
    .select('permission_key')
    .eq('user_id', userId)
    .eq('permission_key', 'platform.superadmin')
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

async function getSupportAccess(supabase: ReturnType<typeof createServerClient>, userId: string) {
  const { data, error } = await supabase
    .from('support_agent_permissions')
    .select('id, role_code, is_active')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function getStaffProfile(supabase: ReturnType<typeof createServerClient>, userId: string) {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('is_company_staff, status, platform_role_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function isDisabledStaff(supabase: ReturnType<typeof createServerClient>, userId: string) {
  const data = await getStaffProfile(supabase, userId);
  if (data?.is_company_staff !== true) return false;
  const status = typeof data?.status === 'string' ? data.status.toLowerCase() : '';
  return INACTIVE_STAFF_STATUSES.has(status);
}

async function isActiveCompanyStaff(supabase: ReturnType<typeof createServerClient>, userId: string) {
  const data = await getStaffProfile(supabase, userId);
  const status = typeof data?.status === 'string' ? data.status.toLowerCase() : '';
  return data?.is_company_staff === true && !INACTIVE_STAFF_STATUSES.has(status);
}

async function getRolePermissionKeys(supabase: ReturnType<typeof createServerClient>, userId: string) {
  const profile = await getStaffProfile(supabase, userId);
  const roleId = typeof profile?.platform_role_id === 'string' ? profile.platform_role_id : null;
  if (!roleId) return [];

  const { data, error } = await supabase
    .from('platform_role_permissions')
    .select('permission_key')
    .eq('role_id', roleId);

  if (error) throw error;
  return ((data || []) as Array<{ permission_key?: unknown }>)
    .map((row) => (typeof row.permission_key === 'string' ? row.permission_key : null))
    .filter((permissionKey): permissionKey is string => Boolean(permissionKey));
}

async function hasOwnedStore(supabase: ReturnType<typeof createServerClient>, userId: string) {
  const { data, error } = await supabase
    .from('stores')
    .select('id')
    .eq('owner_id', userId)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

async function hasAdminAccess(supabase: ReturnType<typeof createServerClient>, userId: string) {
  if (await hasSuperadminPermission(supabase, userId)) return true;
  if (await getSupportAccess(supabase, userId)) return true;
  return isActiveCompanyStaff(supabase, userId);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const normalizedPathname = normalizePathname(pathname);

  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  if (PUBLIC_AUTH_PATHS.has(normalizedPathname)) {
    return response;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });

          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          });

          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (pathname.startsWith('/superadmin')) {
    if (!user) return loginRedirect(request, response, 'unauthenticated', true);

    try {
      if (await isDisabledStaff(supabase, user.id)) return loginRedirect(request, response, 'disabled', false);
      if (await hasSuperadminPermission(supabase, user.id)) return response;
      return loginRedirect(request, response, 'unauthorized', false);
    } catch {
      return loginRedirect(request, response, 'unauthorized', false);
    }
  }

  if (pathname.startsWith('/admin')) {
    if (!user) return loginRedirect(request, response, 'unauthenticated', true);

    try {
      if (await isDisabledStaff(supabase, user.id)) return loginRedirect(request, response, 'disabled', false);
      if (await hasAdminAccess(supabase, user.id)) return response;
      return loginRedirect(request, response, 'unauthorized', false);
    } catch {
      return loginRedirect(request, response, 'unauthorized', false);
    }
  }

  if (pathname.startsWith('/app')) {
    if (!user) return loginRedirect(request, response, 'unauthenticated', true);

    try {
      const [companyStaff, storeAccess] = await Promise.all([
        isActiveCompanyStaff(supabase, user.id).catch(() => false),
        hasOwnedStore(supabase, user.id).catch(() => false),
      ]);

      if (await isDisabledStaff(supabase, user.id)) {
        return loginRedirect(request, response, 'disabled', false);
      }

      if (companyStaff && !storeAccess && (pathname === '/app/dashboard' || pathname === '/app/setup')) {
        return redirectWithCookies(request, response, '/admin');
      }
    } catch {
      return loginRedirect(request, response, 'unauthorized', false);
    }

    return response;
  }

  if (pathname === '/login' || pathname === '/signup') {
    if (!user) return response;

    try {
      if (await isDisabledStaff(supabase, user.id)) return loginRedirect(request, response, 'disabled', false);
    } catch {
      return response;
    }

    try {
      if (await hasSuperadminPermission(supabase, user.id)) return redirectWithCookies(request, response, '/superadmin');
    } catch {
      // Login routing continues to the next available check.
    }

    try {
      if (await getSupportAccess(supabase, user.id)) return redirectWithCookies(request, response, '/admin');
    } catch {
      // Login routing continues to the next available check.
    }

    try {
      const roleKeys = await getRolePermissionKeys(supabase, user.id);
      if (await isActiveCompanyStaff(supabase, user.id) || roleKeys.length > 0) return redirectWithCookies(request, response, '/admin');
    } catch {
      // Login routing continues to the next available check.
    }

    try {
      if (await hasOwnedStore(supabase, user.id)) return redirectWithCookies(request, response, '/app/dashboard');
    } catch {
      // If ownership lookup fails, route to setup as the safest store-user fallback.
    }

    return redirectWithCookies(request, response, '/app/setup');
  }

  return response;
}

export const config = {
  matcher: [
    '/superadmin/:path*',
    '/admin/:path*',
    '/app/:path*',
    '/login',
    '/signup',
    '/forgot-password',
    '/reset-password',
  ],
};
