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
    /*
     * Both settings in one statement, deliberately.
     *
     * `SET LOCAL ROLE x` is `set_config('role', 'x', true)` written another
     * way, so nothing about the guarantee changes — but sent as two statements
     * they cost two round trips, and every RLS-guarded read in the application
     * pays them. Against a database in another region that was the largest
     * single expense in a page render. Order is unchanged: the role drops
     * first, the identity is set second.
     */
    await tx.execute(
      sql`SELECT set_config('role', 'app_runtime', true),
                 set_config('app.current_user_id', ${userId}, true)`,
    );
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
