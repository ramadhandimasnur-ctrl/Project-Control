import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { publicEnv } from '@/lib/env';

/*
 * `/reset-password` is public so that it can explain itself.
 *
 * Someone arriving with a dead link has no session, and bouncing them to the
 * sign-in form answers a question they did not ask: they clicked "atur ulang
 * kata sandi" and landed somewhere that says nothing about why. The page
 * checks the session itself and says the link expired. Nothing is weakened by
 * letting them read that — the action re-checks the session before it changes
 * any password, and a page with no session can only offer a new link.
 */
const PUBLIC_PATHS = [
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/auth',
  '/_next',
  '/favicon.ico',
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Refreshes the Supabase session on every request and keeps unauthenticated
 * traffic out of the application shell.
 *
 * This is a redirect, not an authorisation decision — every service function
 * re-checks the session and the project role on the server.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const env = publicEnv();
  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getUser() revalidates the token with Supabase; getSession() would trust
  // whatever the cookie claims.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  /*
   * `/reset-password` is deliberately absent from this list. Reaching it means
   * holding a recovery session, which makes the visitor "signed in" — bouncing
   * them to the projects list would make the link in the email do nothing.
   */
  if (user && (pathname === '/login' || pathname === '/register' || pathname === '/forgot-password')) {
    const url = request.nextUrl.clone();
    url.pathname = '/projects';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}
