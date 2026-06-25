import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';

function redirectWithCookies(request: NextRequest, response: NextResponse, pathname: string) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = '';
  const redirectResponse = NextResponse.redirect(url);

  response.cookies.getAll().forEach((cookie) => {
    redirectResponse.cookies.set(cookie);
  });

  return redirectResponse;
}

function loginRedirect(
  request: NextRequest,
  response: NextResponse,
  reason: 'unauthenticated' | 'unauthorized',
  includeRedirect: boolean
) {
  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.searchParams.set('reason', reason);

  if (includeRedirect) {
    url.searchParams.set('redirect', `${request.nextUrl.pathname}${request.nextUrl.search}`);
  }

  const redirectResponse = NextResponse.redirect(url);

  response.cookies.getAll().forEach((cookie) => {
    redirectResponse.cookies.set(cookie);
  });

  return redirectResponse;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  let response = NextResponse.next({
    request: { headers: request.headers },
  });

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

  // Get authenticated user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // =============================================
  // SUPERADMIN ROUTES
  // =============================================
  if (pathname.startsWith('/superadmin')) {
    // Not logged in
    if (!user) {
      return loginRedirect(request, response, 'unauthenticated', true);
    }

    // Logged in - check superadmin permission
    // Use try/catch so DB errors never block access silently
    try {
      const { data: perm, error: permError } = await supabase
        .from('user_permissions')
        .select('permission_key')
        .eq('user_id', user.id)
        .eq('permission_key', 'platform.superadmin')
        .maybeSingle();

      if (permError) return response;

      if (!perm) {
        // Not a superadmin - redirect to login
        return loginRedirect(request, response, 'unauthorized', false);
      }

      // Is superadmin - allow through
      return response;
    } catch {
      // DB error - fail open for superadmin
      // (better to allow than lock out the owner)
      return response;
    }
  }

  // =============================================
  // ADMIN STAFF ROUTES
  // =============================================
  if (pathname.startsWith('/admin')) {
    if (!user) {
      return loginRedirect(request, response, 'unauthenticated', true);
    }

    try {
      // Allow if superadmin
      const { data: superPerm, error: superPermError } = await supabase
        .from('user_permissions')
        .select('permission_key')
        .eq('user_id', user.id)
        .eq('permission_key', 'platform.superadmin')
        .maybeSingle();

      if (superPermError) return response;
      if (superPerm) return response;

      // Allow if support agent
      const { data: agentPerm, error: agentPermError } = await supabase
        .from('support_agent_permissions')
        .select('id')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .maybeSingle();

      if (agentPermError) return response;
      if (agentPerm) return response;

      // Neither - redirect
      return loginRedirect(request, response, 'unauthorized', false);
    } catch {
      // DB error - fail open
      return response;
    }
  }

  // =============================================
  // STORE APP ROUTES
  // =============================================
  if (pathname.startsWith('/app')) {
    if (!user) {
      return loginRedirect(request, response, 'unauthenticated', true);
    }
    // Logged in - allow through
    // Page-level checks handle store membership
    return response;
  }

  // =============================================
  // LOGIN / SIGNUP - redirect if already logged in
  // =============================================
  if (pathname === '/login' || pathname === '/signup') {
    if (!user) return response;

    try {
      // Superadmin -> /superadmin
      const { data: superPerm, error: superPermError } = await supabase
        .from('user_permissions')
        .select('permission_key')
        .eq('user_id', user.id)
        .eq('permission_key', 'platform.superadmin')
        .maybeSingle();

      if (superPermError) return response;

      if (superPerm) {
        return redirectWithCookies(request, response, '/superadmin');
      }

      // Support agent -> /admin
      const { data: agentPerm, error: agentPermError } = await supabase
        .from('support_agent_permissions')
        .select('id')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .maybeSingle();

      if (agentPermError) return response;

      if (agentPerm) {
        return redirectWithCookies(request, response, '/admin');
      }

      // Store user -> /app/dashboard
      return redirectWithCookies(request, response, '/app/dashboard');
    } catch {
      // DB error - let them reach login page
      return response;
    }
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
  ],
};
