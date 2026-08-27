import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

/**
 * Creates an authenticated route client and sends Supabase refresh cookies
 * back with the route response that initiated the refresh.
 */
export function createSupabaseRouteClient() {
  const cookieStore = cookies();
  const pendingCookies = new Map<string, { name: string; value: string; options: CookieOptions }>();
  const pendingHeaders = new Map<string, string>();
  const client = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const cookie of cookiesToSet) {
            pendingCookies.set(cookie.name, cookie);
            try {
              cookieStore.set(cookie.name, cookie.value, cookie.options);
            } catch {
              // The response below is the durable cookie carrier for routes.
            }
          }
          for (const [name, value] of Object.entries(headers)) {
            pendingHeaders.set(name, value);
          }
        },
      },
    },
  );

  function json(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    for (const cookie of pendingCookies.values()) {
      response.cookies.set(cookie.name, cookie.value, cookie.options);
    }
    for (const [name, value] of pendingHeaders) {
      response.headers.set(name, value);
    }
    return response;
  }

  return { client, json };
}
