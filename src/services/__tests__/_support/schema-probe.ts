import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';
import { describe, it } from 'vitest';

import { connectionOptions } from '@/db/connection';

/**
 * Decides whether an integration suite has a database to run against.
 *
 * Every suite used to carry its own copy of this, each opening a connection
 * with a five-second connect timeout. Against a pooler in another region under
 * load that is not a generous allowance, and the failure mode was the
 * dangerous one: the probe returned false, the whole suite was skipped, and the
 * run reported green having verified nothing. One sequential run skipped 113
 * tests that way and still exited 0.
 *
 * So two changes. The timeout is long enough for a remote pooler to answer,
 * with one retry — a pooler under load refuses the first connection far more
 * often than the second. And "no database configured" is now told apart from
 * "a database is configured and we could not reach it": the first is a quiet
 * skip, the second is a failure, because a suite that cannot reach the database
 * it was pointed at has not verified anything and must not look as though it
 * had.
 */

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ path: '.env', quiet: true });

export const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

export type SchemaProbe = {
  /** True only when the database answered and the schema is present. */
  ready: boolean;
  reason: 'ok' | 'not-configured' | 'unreachable' | 'schema-missing';
  detail?: string;
};

/*
 * Twenty seconds, not five. The old value was tuned for a database on the same
 * machine; this one has to survive a TLS handshake to another continent while
 * sixteen other suites are asking for connections of their own.
 */
const CONNECT_TIMEOUT_SECONDS = 20;
const ATTEMPTS = 2;

export async function probeSchema(
  label: string,
  check: (db: postgres.Sql) => Promise<boolean>,
): Promise<SchemaProbe> {
  if (!databaseUrl) {
    console.warn(`[${label}] Dilewati: DATABASE_URL belum diisi.`);
    return { ready: false, reason: 'not-configured' };
  }

  let lastError: unknown;

  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const db = postgres(
      connectionOptions(databaseUrl, {
        max: 1,
        prepare: false,
        connect_timeout: CONNECT_TIMEOUT_SECONDS,
        onnotice: () => {},
      }),
    );

    try {
      const present = await check(db);
      if (present) return { ready: true, reason: 'ok' };

      // The database answered and said the schema is not there. Retrying will
      // not change that, and it is a legitimate reason to skip: the suite is
      // ahead of the migrations.
      console.warn(`[${label}] Dilewati: skema belum diterapkan. Jalankan npm run db:setup.`);
      return { ready: false, reason: 'schema-missing' };
    } catch (error) {
      lastError = error;
    } finally {
      await db.end({ timeout: 5 }).catch(() => {});
    }
  }

  return {
    ready: false,
    reason: 'unreachable',
    detail: lastError instanceof Error ? lastError.message : String(lastError),
  };
}

/**
 * Turns an unreachable database into a visible failure.
 *
 * Registered as an ordinary test so it lands in the summary. Without it the
 * only trace is a console warning, and console warnings scroll past — which is
 * exactly how a run that verified nothing came to be reported as passing.
 */
export function guardDatabase(label: string, probe: SchemaProbe): void {
  if (probe.reason !== 'unreachable') return;

  describe(label, () => {
    it('basis data dapat dijangkau', () => {
      throw new Error(
        `Basis data dikonfigurasi tetapi tidak dapat dijangkau, jadi ${label} tidak menguji apa pun.\n` +
          `Penyebab terakhir: ${probe.detail ?? 'tidak diketahui'}`,
      );
    });
  });
}
