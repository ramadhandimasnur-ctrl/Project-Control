import { config as loadEnv } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema';

/**
 * Connection used by the command-line database scripts (migrate, views, seed,
 * reset).
 *
 * These deliberately do not share the request-time pool in `db/index.ts`:
 * DDL has to run over a direct connection, because Supabase's transaction
 * pooler cannot execute it reliably.
 */
export function loadScriptEnv(): void {
  loadEnv({ path: '.env.local', quiet: true });
  loadEnv({ path: '.env', quiet: true });
}

export function directUrl(): string {
  loadScriptEnv();
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DIRECT_URL atau DATABASE_URL belum diisi.\n' +
        'Salin .env.example menjadi .env.local lalu isi connection string Postgres.',
    );
  }
  return url;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '(tidak dapat dibaca)';
  }
}

export function createScriptClient(): postgres.Sql {
  return postgres(directUrl(), { max: 1, prepare: false, onnotice: () => {} });
}

export function createScriptDb(client: postgres.Sql) {
  return drizzle(client, { schema, casing: 'snake_case' });
}
