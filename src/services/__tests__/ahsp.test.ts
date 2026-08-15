import { randomUUID } from 'node:crypto';

import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { connectionOptions } from '@/db/connection';
import type * as AhspModule from '../ahsp';
import type { SessionUser } from '../session';
import type * as TakeoffsModule from '../takeoffs';

/**
 * End-to-end check of the estimate: resources and prices in the catalogue,
 * coefficients on the work item, and the RAB/RAP the service reports.
 *
 * Phase 3 is only done when those figures match a calculator, so the numbers
 * asserted here are the ones worked out by hand in the charter — not values
 * copied back out of a previous run.
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
      WHERE table_schema = 'public' AND table_name IN ('work_items', 'work_item_resources')
    `;
    return rows[0]?.n === 2;
  } catch {
    return false;
  } finally {
    await probe.end();
  }
}

const ready = await schemaIsReady();
if (!ready) console.warn('[AHSP] Dilewati: database belum tersedia.');

describe.skipIf(!ready)('AHSP dan RAB/RAP', () => {
  let sql: postgres.Sql;
  let ahsp: typeof AhspModule;
  let takeoffs: typeof TakeoffsModule;

  const orgId = randomUUID();
  const userId = randomUUID();
  const projectId = randomUUID();
  const workItemId = randomUUID();

  const user: SessionUser = {
    id: userId,
    orgId,
    email: `ahsp-${userId}@uji.test`,
    fullName: 'Estimator Uji',
    globalRole: 'ADMIN',
  };

  const ON_DATE = '2026-03-01';

  /** The K-225 concrete analysis: coefficient, RAB price, RAP price. */
  const ANALYSIS = [
    { code: 'M.01', name: 'semen', unit: 'zak', role: 'MATERIAL', coef: '8', rab: '50000', rap: '48000' },
    { code: 'M.02', name: 'pasir', unit: 'm3', role: 'MATERIAL', coef: '0.5', rab: '300000', rap: '285000' },
    { code: 'M.03', name: 'kricak', unit: 'm3', role: 'MATERIAL', coef: '0.8', rab: '350000', rap: '335000' },
    { code: 'L.01', name: 'pekerja', unit: 'OH', role: 'LABOR', coef: '1.65', rab: '120000', rap: '115000' },
    { code: 'L.02', name: 'tukang batu', unit: 'OH', role: 'LABOR', coef: '0.275', rab: '150000', rap: '145000' },
    { code: 'L.03', name: 'mandor', unit: 'OH', role: 'LABOR', coef: '0.083', rab: '180000', rap: '175000' },
    { code: 'E.01', name: 'mixer', unit: 'jam', role: 'EQUIPMENT', coef: '0.5', rab: '85000', rap: '80000' },
  ] as const;

  const buildFixture = async (): Promise<void> => {
    const unitIds = new Map<string, string>();
    for (const unit of ['m3', 'zak', 'OH', 'jam']) unitIds.set(unit, randomUUID());

    const statements: string[] = [
      'BEGIN',
      "SELECT set_config('app.bypass_rls', 'on', true)",
      "SELECT set_config('app.allow_hard_delete', 'on', true)",
      `DELETE FROM projects WHERE org_id = '${orgId}'`,
      `DELETE FROM resources WHERE org_id = '${orgId}'`,
      `DELETE FROM units WHERE org_id = '${orgId}'`,
      `DELETE FROM users WHERE org_id = '${orgId}'`,
      `DELETE FROM organizations WHERE id = '${orgId}'`,
      `INSERT INTO organizations (id, name) VALUES ('${orgId}', 'Org AHSP (uji)')`,
      `INSERT INTO users (id, org_id, email, full_name, global_role)
         VALUES ('${userId}', '${orgId}', '${user.email}', '${user.fullName}', 'ADMIN')`,
      `INSERT INTO projects (id, org_id, code, name, start_date, end_date, contract_value, default_markup)
         VALUES ('${projectId}', '${orgId}', 'AHSP-1', 'Proyek AHSP', '2026-01-01', '2026-12-31', 125000000, 0)`,
      `INSERT INTO project_members (project_id, user_id, role)
         VALUES ('${projectId}', '${userId}', 'PROJECT_MANAGER')`,
    ];

    for (const [code, id] of unitIds) {
      const dimension =
        code === 'm3' ? 'VOLUME' : code === 'zak' ? 'COUNT' : 'TIME';
      statements.push(
        `INSERT INTO units (id, org_id, code, name, dimension)
           VALUES ('${id}', '${orgId}', '${code}', '${code}', '${dimension}')`,
      );
    }

    const resourceIds = new Map<string, string>();
    for (const row of ANALYSIS) {
      const id = randomUUID();
      resourceIds.set(row.code, id);
      const type = row.role === 'LABOR' ? 'LABOR' : row.role === 'EQUIPMENT' ? 'EQUIPMENT' : 'MATERIAL';
      statements.push(
        `INSERT INTO resources (id, org_id, code, name, unit_id, type)
           VALUES ('${id}', '${orgId}', '${row.code}', '${row.name}', '${unitIds.get(row.unit)}', '${type}')`,
        `INSERT INTO resource_prices (resource_id, project_id, price_type, price, effective_from)
           VALUES ('${id}', NULL, 'RAB', ${row.rab}, '${ON_DATE}')`,
        `INSERT INTO resource_prices (resource_id, project_id, price_type, price, effective_from)
           VALUES ('${id}', NULL, 'RAP', ${row.rap}, '${ON_DATE}')`,
      );
    }

    statements.push(
      `INSERT INTO work_items (id, project_id, code, name, unit_id, volume, contract_unit_price)
         VALUES ('${workItemId}', '${projectId}', 'A.01', 'Beton K-225',
                 '${unitIds.get('m3')}', 100, 1250000)`,
    );

    for (const [index, row] of ANALYSIS.entries()) {
      statements.push(
        `INSERT INTO work_item_resources (work_item_id, resource_id, role, coef_rab, coef_rap, sort_order)
           VALUES ('${workItemId}', '${resourceIds.get(row.code)}', '${row.role}',
                   ${row.coef}, ${row.coef}, ${index})`,
      );
    }

    statements.push('COMMIT');
    await sql.unsafe(statements.join(';\n')).simple();
  };

  beforeAll(async () => {
    sql = postgres(connectionOptions(url!, { max: 1, prepare: false, onnotice: () => {} }));
    [ahsp, takeoffs] = await Promise.all([import('../ahsp'), import('../takeoffs')]);
  });

  beforeEach(buildFixture);

  afterAll(async () => {
    if (!sql) return;
    await sql.unsafe(`
      BEGIN;
      SELECT set_config('app.bypass_rls', 'on', true);
      SELECT set_config('app.allow_hard_delete', 'on', true);
      DELETE FROM projects WHERE org_id = '${orgId}';
      DELETE FROM resources WHERE org_id = '${orgId}';
      DELETE FROM units WHERE org_id = '${orgId}';
      DELETE FROM users WHERE org_id = '${orgId}';
      DELETE FROM organizations WHERE id = '${orgId}';
      COMMIT;
    `).simple();
    await sql.end();
  });

  describe('analisa satu pekerjaan', () => {
    it('menghasilkan harga satuan dan total yang cocok dengan hitungan tangan', async () => {
      const estimate = await ahsp.getWorkItemEstimate(userId, projectId, workItemId, ON_DATE);

      // 400.000 + 150.000 + 280.000 + 198.000 + 41.250 + 14.940 + 42.500
      expect(estimate.unitCostRab).toBe('1126690.00');
      // 384.000 + 142.500 + 268.000 + 189.750 + 39.875 + 14.525 + 40.000
      expect(estimate.unitCostRap).toBe('1078650.00');

      expect(estimate.totalRab).toBe('112669000.00');
      expect(estimate.totalRap).toBe('107865000.00');
      expect(estimate.contractValue).toBe('125000000.00');
      expect(estimate.margin).toBe('17135000.00');
    });

    // The charter's own worked example: 100 m3 x 8 zak x Rp48.000.
    it('menghitung kebutuhan dan nilai semen persis seperti contoh dokumen', async () => {
      const estimate = await ahsp.getWorkItemEstimate(userId, projectId, workItemId, ON_DATE);
      const cement = estimate.lines.find((l) => l.resourceCode === 'M.01');

      expect(cement?.qtyRap).toBe('800.0000');
      expect(cement?.amountRap).toBe('38400000.00');
    });

    it('menjumlahkan per bagian analisa untuk footer', async () => {
      const estimate = await ahsp.getWorkItemEstimate(userId, projectId, workItemId, ON_DATE);

      // 384.000 + 142.500 + 268.000, dikali volume 100
      expect(estimate.subtotalsRap.MATERIAL).toBe('79450000.00');
      // 189.750 + 39.875 + 14.525, dikali volume 100
      expect(estimate.subtotalsRap.LABOR).toBe('24415000.00');
      expect(estimate.subtotalsRap.EQUIPMENT).toBe('4000000.00');
    });

    it('menerapkan faktor susut tepat sebesar persentasenya', async () => {
      await sql.unsafe(`
        UPDATE work_item_resources SET waste_factor = 0.05
        WHERE work_item_id = '${workItemId}'
          AND resource_id = (SELECT id FROM resources WHERE org_id = '${orgId}' AND code = 'M.01')
      `);

      const estimate = await ahsp.getWorkItemEstimate(userId, projectId, workItemId, ON_DATE);
      const cement = estimate.lines.find((l) => l.resourceCode === 'M.01');

      expect(cement?.qtyRap).toBe('840.0000');
      expect(cement?.amountRap).toBe('40320000.00');
    });

    // A resource with no price must not silently become zero in the total
    // without the user being told which one it was.
    it('melaporkan harga yang belum diisi alih-alih diam-diam menganggapnya nol', async () => {
      await sql.unsafe(`
        DELETE FROM resource_prices
        WHERE price_type = 'RAP'
          AND resource_id = (SELECT id FROM resources WHERE org_id = '${orgId}' AND code = 'E.01')
      `);

      const estimate = await ahsp.getWorkItemEstimate(userId, projectId, workItemId, ON_DATE);

      const mixer = estimate.lines.find((l) => l.resourceCode === 'E.01');
      expect(mixer?.priceRap).toBeNull();
      expect(mixer?.amountRap).toBeNull();

      const missing = estimate.missingPrices.find((m) => m.code === 'E.01');
      expect(missing?.priceType).toBe('RAP');

      // The total drops by exactly the mixer's contribution, nothing else.
      expect(estimate.totalRap).toBe('103865000.00');
    });
  });

  describe('estimasi seluruh proyek', () => {
    it('menghitung bobot, total, dan rekonsiliasi nilai kontrak', async () => {
      const estimate = await ahsp.getProjectEstimate(userId, projectId, ON_DATE);

      expect(estimate.items).toHaveLength(1);
      expect(estimate.items[0]?.weight).toBe('1.000000');
      expect(estimate.totals.totalRap).toBe('107865000.00');
      expect(estimate.totals.contractValue).toBe('125000000.00');

      // Declared contract value matches the sum of the work items exactly.
      expect(estimate.reconciliation.difference).toBe('0.00');
      expect(estimate.reconciliation.needsAttention).toBe(false);
    });

    // Design decision 1: the gap is reported, never silently absorbed.
    it('menandai selisih rekonsiliasi lebih dari 0,1%', async () => {
      await sql.unsafe(
        `UPDATE projects SET contract_value = 140000000 WHERE id = '${projectId}'`,
      );

      const estimate = await ahsp.getProjectEstimate(userId, projectId, ON_DATE);
      expect(estimate.reconciliation.difference).toBe('-15000000.00');
      expect(estimate.reconciliation.needsAttention).toBe(true);
    });

    it('memberi bobot nol pada pekerjaan yang dikecualikan dari progres', async () => {
      await sql.unsafe(
        `UPDATE work_items SET include_in_progress_weight = false WHERE id = '${workItemId}'`,
      );

      const estimate = await ahsp.getProjectEstimate(userId, projectId, ON_DATE);
      expect(estimate.items[0]?.weight).toBe('0.000000');
      // Cost is still counted; only progress weight is withheld.
      expect(estimate.totals.totalRap).toBe('107865000.00');
    });
  });

  describe('volume take-off', () => {
    it('menurunkan volume pekerjaan dari baris take-off', async () => {
      await takeoffs.saveTakeoff(user, projectId, workItemId, null, {
        label: 'Pelat A',
        expression: '3 × 4,5 × 0,15',
        qty: '0.0000',
        note: null,
        sortOrder: 0,
      });
      const second = await takeoffs.saveTakeoff(user, projectId, workItemId, null, {
        label: 'Pelat B',
        expression: null,
        qty: '2.5000',
        note: null,
        sortOrder: 1,
      });

      // 2,025 + 2,5
      expect(second.volume).toBe('4.5250');

      const estimate = await ahsp.getWorkItemEstimate(userId, projectId, workItemId, ON_DATE);
      expect(estimate.volume).toBe('4.5250');
      // The estimate follows the derived volume, not the original 100.
      expect(estimate.totalRap).toBe(
        (1078650 * 4.525).toFixed(2),
      );
    });

    it('menolak ekspresi yang bukan aritmetika', async () => {
      await expect(
        takeoffs.saveTakeoff(user, projectId, workItemId, null, {
          label: 'Jahat',
          expression: 'process.exit(1)',
          qty: '0.0000',
          note: null,
          sortOrder: 0,
        }),
      ).rejects.toThrow(/tidak dapat dipakai|tidak dikenal/i);
    });

    it('memperbarui volume kembali setelah baris dihapus', async () => {
      const first = await takeoffs.saveTakeoff(user, projectId, workItemId, null, {
        label: 'A', expression: '2 * 3', qty: '0.0000', note: null, sortOrder: 0,
      });
      await takeoffs.saveTakeoff(user, projectId, workItemId, null, {
        label: 'B', expression: '4', qty: '0.0000', note: null, sortOrder: 1,
      });

      const after = await takeoffs.deleteTakeoff(user, projectId, workItemId, first.id);
      expect(after.volume).toBe('4.0000');
    });
  });
});
