import { randomUUID } from 'node:crypto';

import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { connectionOptions } from '@/db/connection';
import { type UtbaParseResult } from '@/lib/import/utba';
import type { importUtba as ImportUtbaFn } from '../import-utba';

/**
 * Persistence tests for the UTBA import.
 *
 * The parser has its own unit tests; what those cannot cover is whether the
 * import is genuinely idempotent, genuinely atomic, and genuinely refuses to
 * overwrite a unit — all of which are properties of the write path against a
 * real database. Skips itself when no database is reachable.
 */

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ path: '.env', quiet: true });

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

async function schemaIsReady(): Promise<boolean> {
  if (!url) return false;
  const probe = postgres(connectionOptions(url, { max: 1, prepare: false, connect_timeout: 5 }));
  try {
    const rows = await probe`
      SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('resources', 'resource_prices')
    `;
    return rows[0]?.n === 2;
  } catch {
    return false;
  } finally {
    await probe.end();
  }
}

const ready = await schemaIsReady();
if (!ready) {
  console.warn('[impor UTBA] Dilewati: database belum tersedia. Jalankan npm run db:setup.');
}

/** A miniature sheet: one labour block, one material block, three rows. */
function fixture(overrides: Partial<UtbaParseResult> = {}): UtbaParseResult {
  return {
    categories: [
      { code: 'TENAGA', name: 'TENAGA', type: 'LABOR', parentCode: null, rowNumber: 6 },
      { code: 'IRENGAN', name: 'Irengan', type: 'LABOR', parentCode: 'TENAGA', rowNumber: 7 },
      { code: 'MATERIAL', name: 'MATERIAL', type: 'MATERIAL', parentCode: null, rowNumber: 20 },
    ],
    units: [
      { code: 'm2', dimension: 'AREA', usageCount: 1 },
      { code: 'zak', dimension: 'COUNT', usageCount: 1 },
      { code: 'm3', dimension: 'VOLUME', usageCount: 1 },
    ],
    resources: [
      {
        rowNumber: 8, code: 'T.01', name: 'Pekerjaan pembersihan', spec: null, note: null,
        unitCode: 'm2', price: '1440.00', categoryCode: 'IRENGAN', categoryName: 'Irengan', type: 'LABOR',
      },
      {
        rowNumber: 21, code: 'B.01', name: 'semen', spec: 'PC 40 kg', note: 'Tiga Roda',
        unitCode: 'zak', price: '48000.00', categoryCode: 'MATERIAL', categoryName: 'MATERIAL', type: 'MATERIAL',
      },
      {
        rowNumber: 22, code: 'B.02', name: 'pasir', spec: null, note: null,
        unitCode: 'm3', price: '285000.00', categoryCode: 'MATERIAL', categoryName: 'MATERIAL', type: 'MATERIAL',
      },
    ],
    issues: [],
    ...overrides,
  };
}

describe.skipIf(!ready)('impor UTBA — lapisan penyimpanan', () => {
  let sql: postgres.Sql;
  // Imported lazily inside beforeAll so the module — and its database pool —
  // is never constructed when the suite is skipped.
  let importUtba: typeof ImportUtbaFn;

  const orgId = randomUUID();
  const userId = randomUUID();
  const actor = {
    id: userId,
    orgId,
    email: `impor-${userId}@uji.test`,
    fullName: 'Penguji Impor',
    globalRole: 'ADMIN' as const,
  };

  const ON_DATE = '2026-03-01';

  const counts = async () => {
    const [row] = await sql`
      SELECT
        (SELECT count(*)::int FROM resources WHERE org_id = ${orgId})           AS resources,
        (SELECT count(*)::int FROM resource_categories WHERE org_id = ${orgId}) AS categories,
        (SELECT count(*)::int FROM units WHERE org_id = ${orgId})               AS units,
        (SELECT count(*)::int FROM resource_prices p
           JOIN resources r ON r.id = p.resource_id WHERE r.org_id = ${orgId})  AS prices
    `;
    return row as { resources: number; categories: number; units: number; prices: number };
  };

  beforeAll(async () => {
    sql = postgres(connectionOptions(url!, { max: 1, prepare: false, onnotice: () => {} }));
    ({ importUtba } = await import('../import-utba'));
  });

  beforeEach(async () => {
    await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.bypass_rls', 'on', true)`;
      await tx`DELETE FROM users WHERE org_id = ${orgId}`;
      await tx`DELETE FROM resources WHERE org_id = ${orgId}`;
      await tx`DELETE FROM resource_categories WHERE org_id = ${orgId}`;
      await tx`DELETE FROM units WHERE org_id = ${orgId}`;
      await tx`DELETE FROM organizations WHERE id = ${orgId}`;

      await tx`INSERT INTO organizations (id, name) VALUES (${orgId}, 'Org Impor (uji)')`;
      await tx`
        INSERT INTO users (id, org_id, email, full_name, global_role)
        VALUES (${userId}, ${orgId}, ${actor.email}, ${actor.fullName}, 'ADMIN')
      `;
    });
  });

  afterAll(async () => {
    if (!sql) return;
    await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.bypass_rls', 'on', true)`;
      await tx`DELETE FROM resources WHERE org_id = ${orgId}`;
      await tx`DELETE FROM resource_categories WHERE org_id = ${orgId}`;
      await tx`DELETE FROM units WHERE org_id = ${orgId}`;
      await tx`DELETE FROM users WHERE org_id = ${orgId}`;
      await tx`DELETE FROM organizations WHERE id = ${orgId}`;
    });
    await sql.end();
  });

  it('menyimpan satuan, kategori, sumber daya, dan harga', async () => {
    const report = await importUtba(actor, fixture(), { onDate: ON_DATE, priceTypes: ['RAP'] });

    expect(report.units).toEqual({ created: 3, existing: 0 });
    expect(report.categories).toEqual({ created: 3, existing: 0 });
    expect(report.resources).toEqual({ created: 3, updated: 0, unchanged: 0 });
    expect(report.prices).toEqual({ created: 3, unchanged: 0, superseded: 0 });

    expect(await counts()).toEqual({ resources: 3, categories: 3, units: 3, prices: 3 });
  });

  // The whole point of the dry run: real counts, no trace left behind.
  it('uji coba tidak meninggalkan apa pun', async () => {
    const report = await importUtba(actor, fixture(), {
      onDate: ON_DATE,
      priceTypes: ['RAP'],
      dryRun: true,
    });

    expect(report.dryRun).toBe(true);
    expect(report.resources.created).toBe(3);
    expect(await counts()).toEqual({ resources: 0, categories: 0, units: 0, prices: 0 });
  });

  it('idempoten: menjalankan ulang tidak membuat baris baru', async () => {
    await importUtba(actor, fixture(), { onDate: ON_DATE, priceTypes: ['RAP'] });
    const second = await importUtba(actor, fixture(), { onDate: ON_DATE, priceTypes: ['RAP'] });

    expect(second.units).toEqual({ created: 0, existing: 3 });
    expect(second.categories).toEqual({ created: 0, existing: 3 });
    expect(second.resources).toEqual({ created: 0, updated: 0, unchanged: 3 });
    expect(second.prices).toEqual({ created: 0, unchanged: 3, superseded: 0 });

    expect(await counts()).toEqual({ resources: 3, categories: 3, units: 3, prices: 3 });
  });

  it('memperbarui nama dan spesifikasi yang berubah di file', async () => {
    await importUtba(actor, fixture(), { onDate: ON_DATE, priceTypes: ['RAP'] });

    const corrected = fixture();
    corrected.resources[1]!.name = 'semen portland';
    corrected.resources[1]!.spec = 'PC 50 kg';

    const report = await importUtba(actor, corrected, { onDate: ON_DATE, priceTypes: ['RAP'] });
    expect(report.resources).toEqual({ created: 0, updated: 1, unchanged: 2 });

    const [row] = await sql`SELECT name, spec FROM resources WHERE org_id = ${orgId} AND code = 'B.01'`;
    expect(row?.name).toBe('semen portland');
    expect(row?.spec).toBe('PC 50 kg');
  });

  describe('harga', () => {
    it('mengganti entri pada tanggal berlaku yang sama, bukan menggandakannya', async () => {
      await importUtba(actor, fixture(), { onDate: ON_DATE, priceTypes: ['RAP'] });

      const dearer = fixture();
      dearer.resources[1]!.price = '52000.00';

      const report = await importUtba(actor, dearer, { onDate: ON_DATE, priceTypes: ['RAP'] });
      expect(report.prices).toEqual({ created: 0, unchanged: 2, superseded: 1 });

      const rows = await sql`
        SELECT p.price FROM resource_prices p
        JOIN resources r ON r.id = p.resource_id
        WHERE r.org_id = ${orgId} AND r.code = 'B.01'
      `;
      expect(rows).toHaveLength(1);
      expect(Number(rows[0]?.price)).toBe(52000);
    });

    // Charter section 5.7: a price is never overwritten, so an old estimate
    // stays explainable. A new date is a new entry alongside the old one.
    it('tanggal berlaku baru menjadi entri tambahan, yang lama tetap ada', async () => {
      await importUtba(actor, fixture(), { onDate: ON_DATE, priceTypes: ['RAP'] });

      const later = fixture();
      later.resources[1]!.price = '52000.00';
      await importUtba(actor, later, { onDate: '2026-06-01', priceTypes: ['RAP'] });

      const rows = await sql`
        SELECT p.price, p.effective_from FROM resource_prices p
        JOIN resources r ON r.id = p.resource_id
        WHERE r.org_id = ${orgId} AND r.code = 'B.01'
        ORDER BY p.effective_from
      `;
      expect(rows).toHaveLength(2);
      expect(Number(rows[0]?.price)).toBe(48000);
      expect(Number(rows[1]?.price)).toBe(52000);
    });

    it('menulis RAB dan RAP sekaligus bila diminta', async () => {
      const report = await importUtba(actor, fixture(), {
        onDate: ON_DATE,
        priceTypes: ['RAB', 'RAP'],
      });
      expect(report.prices.created).toBe(6);

      const rows = await sql`
        SELECT DISTINCT p.price_type FROM resource_prices p
        JOIN resources r ON r.id = p.resource_id WHERE r.org_id = ${orgId}
        ORDER BY p.price_type
      `;
      expect(rows.map((r) => r.price_type)).toEqual(['RAB', 'RAP']);
    });
  });

  // Rewriting a unit would reinterpret every coefficient already recorded
  // against the resource, so the import reports the difference instead.
  it('tidak pernah menimpa satuan sumber daya yang sudah ada', async () => {
    await importUtba(actor, fixture(), { onDate: ON_DATE, priceTypes: ['RAP'] });

    const reunited = fixture();
    reunited.resources[1]!.unitCode = 'm3';

    const report = await importUtba(actor, reunited, { onDate: ON_DATE, priceTypes: ['RAP'] });

    const [row] = await sql`
      SELECT u.code FROM resources r JOIN units u ON u.id = r.unit_id
      WHERE r.org_id = ${orgId} AND r.code = 'B.01'
    `;
    expect(row?.code).toBe('zak');

    const warning = report.issues.find((i) => i.code === 'B.01');
    expect(warning?.severity).toBe('WARNING');
    expect(warning?.message).toMatch(/satuan lama dipertahankan/i);
  });

  it('menyusun kategori bertingkat sesuai induknya', async () => {
    await importUtba(actor, fixture(), { onDate: ON_DATE, priceTypes: ['RAP'] });

    const [child] = await sql`
      SELECT c.code, p.code AS parent
      FROM resource_categories c
      LEFT JOIN resource_categories p ON p.id = c.parent_id
      WHERE c.org_id = ${orgId} AND c.code = 'IRENGAN'
    `;
    expect(child?.parent).toBe('TENAGA');
  });

  it('menolak pengguna yang bukan administrator organisasi', async () => {
    const memberId = randomUUID();
    await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.bypass_rls', 'on', true)`;
      await tx`
        INSERT INTO users (id, org_id, email, full_name, global_role)
        VALUES (${memberId}, ${orgId}, ${`m-${memberId}@uji.test`}, 'Anggota', 'MEMBER')
      `;
    });

    await expect(
      importUtba({ ...actor, id: memberId, globalRole: 'MEMBER' }, fixture(), {
        onDate: ON_DATE,
        priceTypes: ['RAP'],
      }),
    ).rejects.toThrow(/administrator organisasi/i);

    expect((await counts()).resources).toBe(0);
  });
});
