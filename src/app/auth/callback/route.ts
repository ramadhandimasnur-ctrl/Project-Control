import { NextResponse, type NextRequest } from 'next/server';

import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Where the link in a Supabase Auth email lands.
 *
 * The mail carries a one-time code, not a session. Exchanging it here — on the
 * server, where the cookie can actually be set — is what turns the click into
 * something the next page can act on. A reset form reached without that step
 * would have nobody to change the password of.
 *
 * `next` is only honoured when it is a path on this site. An open redirect on
 * an authentication callback is how a reset link gets forwarded to somewhere
 * that harvests the session it just created.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const requested = searchParams.get('next');
  const next = requested && requested.startsWith('/') && !requested.startsWith('//')
    ? requested
    : '/projects';

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=tautan-tidak-lengkap`);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    // Expired, already used, or issued for another browser. All three mean the
    // same thing to the person holding it: ask for a new one.
    return NextResponse.redirect(`${origin}/login?error=tautan-kedaluwarsa`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
