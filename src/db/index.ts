import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { serverEnv } from '@/lib/env';

import * as schema from './schema';

/**
 * A single pooled connection per process. Next.js dev reloads the module graph
 * on every edit, so the handle is parked on `globalThis` to avoid leaking a
 * new pool per hot reload.
 */
const globalForDb = globalThis as typeof globalThis & {
  __pcSql?: postgres.Sql;
};

function createClient(): postgres.Sql {
  return postgres(serverEnv().DATABASE_URL, {
    max: 10,
    idle_timeout: 20,
    // Supabase's transaction pooler does not support prepared statements.
    prepare: false,
    types: {
      // `numeric` must never round-trip through a JS float. Keep it a string
      // all the way to decimal.js.
      bigint: postgres.BigInt,
    },
  });
}

export const sqlClient: postgres.Sql = globalForDb.__pcSql ?? createClient();

if (process.env.NODE_ENV !== 'production') {
  globalForDb.__pcSql = sqlClient;
}

export const db = drizzle(sqlClient, { schema, casing: 'snake_case' });

export type Database = typeof db;
/** The transaction handle passed to `db.transaction(async (tx) => …)`. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Anything that can run a query: the pool or an open transaction. */
export type DbExecutor = Database | Transaction;

export { schema };
