import 'server-only';

import { eq } from 'drizzle-orm';
import { cache } from 'react';

import { db } from '@/db';
import { users } from '@/db/schema';
import { type GlobalRole } from '@/lib/auth/roles';
import { unauthenticated } from '@/lib/errors';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export type SessionUser = {
  id: string;
  orgId: string;
  email: string;
  fullName: string;
  globalRole: GlobalRole;
};

/**
 * The signed-in user, or null.
 *
 * Two lookups on purpose: Supabase Auth answers "who is this", the `users`
 * table answers "what are they in this application". A Supabase account with
 * no active row here is treated as not signed in.
 *
 * Memoised per request. Both lookups cross the network, the layout and the
 * page each ask for the user, and neither the token nor the row can change
 * between them.
 */
export const getSessionUser: () => Promise<SessionUser | null> = cache(async () => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const [row] = await db
    .select({
      id: users.id,
      orgId: users.orgId,
      email: users.email,
      fullName: users.fullName,
      globalRole: users.globalRole,
      isActive: users.isActive,
    })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  if (!row || !row.isActive) return null;

  return {
    id: row.id,
    orgId: row.orgId,
    email: row.email,
    fullName: row.fullName,
    globalRole: row.globalRole,
  };
});

export async function requireSessionUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw unauthenticated();
  return user;
}
