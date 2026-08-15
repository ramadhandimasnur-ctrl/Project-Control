import { sql } from 'drizzle-orm';

import { db, type Transaction } from './index';

/**
 * Binds a database transaction to an application user.
 *
 * Every RLS policy reads `app.current_user_id`; with the GUC unset each policy
 * evaluates false, so an unbound connection sees nothing at all. That is
 * deliberate — the second authorisation layer fails closed.
 *
 * `set_config(..., true)` is transaction-local, so the identity cannot leak to
 * the next borrower of a pooled connection.
 */
export async function withUser<T>(
  userId: string,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
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
