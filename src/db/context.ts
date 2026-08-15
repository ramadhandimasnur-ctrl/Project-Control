import { sql } from 'drizzle-orm';

import { db, type Transaction } from './index';

/**
 * Binds a database transaction to an application user.
 *
 * Two statements, both transaction-local so nothing leaks to the next borrower
 * of a pooled connection:
 *
 *   SET LOCAL ROLE app_runtime
 *     Supabase's `postgres` role has BYPASSRLS, which makes it ignore every
 *     policy — FORCE ROW LEVEL SECURITY included. Dropping to `app_runtime`,
 *     which has no such attribute, is what makes the policies bind at all.
 *     Without this the second authorisation layer is inert.
 *
 *   set_config('app.current_user_id', …)
 *     The identity every policy reads. With the GUC unset each policy
 *     evaluates false, so an unbound transaction sees nothing — it fails
 *     closed, not open.
 */
export async function withUser<T>(
  userId: string,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE app_runtime`);
    await tx.execute(sql`SELECT set_config('app.current_user_id', ${userId}, true)`);
    return fn(tx);
  });
}

/**
 * Runs outside row-level security. Reserved for migrations, the seed script
 * and system maintenance — never for a request handler, which always has a
 * user to act as.
 */
export async function withBypass<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
    return fn(tx);
  });
}
