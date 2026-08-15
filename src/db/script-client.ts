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

type PgError = Error & { code?: string; detail?: string; hint?: string };

/**
 * Renders a database failure with the part that actually identifies it.
 *
 * `error.message` alone loses the SQLSTATE, the detail and the hint — which is
 * the difference between "Migrasi gagal" and "password salah". The common
 * causes get a plain-language explanation and the concrete next step.
 */
export function describeDbError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);

  // Drizzle's migrator rethrows as "Failed query: …" and hides the driver
  // error — and with it the SQLSTATE — in `cause`. Walk down to the row that
  // actually carries a code.
  let e = error as PgError;
  const chain: string[] = [];
  let depth = 0;
  while (!e.code && e.cause instanceof Error && depth < 5) {
    chain.push(e.message.split('\n')[0] ?? '');
    e = e.cause as PgError;
    depth += 1;
  }

  const lines = [...chain, e.message];

  if (e.code) lines.push(`  SQLSTATE: ${e.code}`);
  if (e.detail) lines.push(`  Detail  : ${e.detail}`);
  if (e.hint) lines.push(`  Petunjuk: ${e.hint}`);

  const advice: Record<string, string> = {
    '28P01':
      'Password database salah. Ambil ulang dari Supabase → Project Settings → Database →\n' +
      '  Reset database password, lalu tempel ke DATABASE_URL dan DIRECT_URL di .env.local.\n' +
      '  Karakter non-alfanumerik pada password harus di-percent-encode\n' +
      '  (@ menjadi %40, / menjadi %2F, : menjadi %3A, # menjadi %23).',
    '3D000': 'Nama database tidak ditemukan. Pada Supabase nama database selalu "postgres".',
    '42501':
      'Peran database tidak memiliki izin yang diperlukan. Pastikan connection string memakai\n' +
      '  peran "postgres", bukan peran terbatas.',
    ENOTFOUND:
      'Host tidak dapat ditemukan. Periksa kembali hostname pada connection string.',
    ETIMEDOUT:
      'Koneksi timeout. Bila memakai "Direct connection" Supabase, ganti ke "Session pooler":\n' +
      '  direct connection kini hanya IPv6 dan sering tidak terjangkau.',
  };

  const tip = e.code ? advice[e.code] : undefined;
  if (tip) lines.push('', tip);

  return lines.join('\n');
}

export function createScriptDb(client: postgres.Sql) {
  return drizzle(client, { schema, casing: 'snake_case' });
}
