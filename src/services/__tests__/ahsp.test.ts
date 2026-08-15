import { randomUUID } from 'node:crypto';

import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { connectionOptions } from '@/db/connection';
import type * as AhspModule from '../ahsp';
import type * as AhspTemplatesModule from '../ahsp-templates';
import type { SessionUser } from '../session';
import type * as TakeoffsModule from '../takeoffs';
import type * as WorkBreakdownModule from '../work-breakdown';

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
      // Templates hold RESTRICT references to resources, so they have to go
      // first; their own lines cascade with them.
      `DELETE FROM ahsp_templates WHERE org_id = '${orgId}'`,
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
      DELETE FROM ahsp_templates WHERE org_id = '${orgId}';
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

  /**
   * views.sql promises each view ships with a test asserting it agrees with the
   * pure function it mirrors. These are those tests. A view is a performance
   * mirror, never a second opinion — if the two disagree, the view is wrong.
   */
  describe('view SQL sepakat dengan lib/calc', () => {
    const round2 = (v: unknown) => Number(v).toFixed(2);

    it('v_work_item_cost cocok dengan getWorkItemEstimate', async () => {
      const estimate = await ahsp.getWorkItemEstimate(userId, projectId, workItemId);
      const [row] = await sql`
        SELECT unit_cost_rab, unit_cost_rap, total_rab, total_rap, contract_value, margin
        FROM v_work_item_cost WHERE work_item_id = ${workItemId}
      `;

      expect(round2(row?.unit_cost_rab)).toBe(estimate.unitCostRab);
      expect(round2(row?.unit_cost_rap)).toBe(estimate.unitCostRap);
      expect(round2(row?.total_rab)).toBe(estimate.totalRab);
      expect(round2(row?.total_rap)).toBe(estimate.totalRap);
      expect(round2(row?.contract_value)).toBe(estimate.contractValue);
      expect(round2(row?.margin)).toBe(estimate.margin);
    });

    it('v_work_item_weight cocok dengan getProjectEstimate', async () => {
      const estimate = await ahsp.getProjectEstimate(userId, projectId);
      const rows = await sql`
        SELECT work_item_id, weight FROM v_work_item_weight WHERE project_id = ${projectId}
      `;

      for (const item of estimate.items) {
        const row = rows.find((r) => r.work_item_id === item.workItemId);
        expect(Number(row?.weight).toFixed(6)).toBe(item.weight);
      }
    });

    it('v_project_cost_summary cocok dengan total getProjectEstimate', async () => {
      const estimate = await ahsp.getProjectEstimate(userId, projectId);
      const [row] = await sql`
        SELECT total_rab, total_rap, contract_value_derived, contract_value_difference, margin
        FROM v_project_cost_summary WHERE project_id = ${projectId}
      `;

      expect(round2(row?.total_rab)).toBe(estimate.totals.totalRab);
      expect(round2(row?.total_rap)).toBe(estimate.totals.totalRap);
      expect(round2(row?.contract_value_derived)).toBe(estimate.totals.contractValue);
      expect(round2(row?.contract_value_difference)).toBe(estimate.reconciliation.difference);
      expect(round2(row?.margin)).toBe(estimate.totals.margin);
    });

    it('v_material_requirement menghitung kebutuhan pada koefisien RAP', async () => {
      const rows = await sql`
        SELECT resource_code, qty_required, value_rap
        FROM v_material_requirement WHERE project_id = ${projectId}
        ORDER BY resource_code
      `;

      // 100 m3 x 8 zak = 800 zak, senilai Rp38.400.000 pada RAP 48.000.
      const cement = rows.find((r) => r.resource_code === 'M.01');
      expect(Number(cement?.qty_required).toFixed(4)).toBe('800.0000');
      expect(round2(cement?.value_rap)).toBe('38400000.00');

      expect(rows).toHaveLength(ANALYSIS.length);
    });

    // The view resolves prices as of CURRENT_DATE; a price dated ahead must not
    // be picked up early, exactly as selectEffectivePrice refuses it.
    it('view mengabaikan harga yang belum berlaku', async () => {
      await sql.unsafe(`
        INSERT INTO resource_prices (resource_id, project_id, price_type, price, effective_from)
        VALUES ((SELECT id FROM resources WHERE org_id = '${orgId}' AND code = 'M.01'),
                NULL, 'RAP', 999999, CURRENT_DATE + 30)
      `);

      const [row] = await sql`
        SELECT total_rap FROM v_work_item_cost WHERE work_item_id = ${workItemId}
      `;
      expect(round2(row?.total_rap)).toBe('107865000.00');
    });

    // A project override outranks the organisation default even when older.
    it('view mendahulukan harga khusus proyek', async () => {
      await sql.unsafe(`
        INSERT INTO resource_prices (resource_id, project_id, price_type, price, effective_from)
        VALUES ((SELECT id FROM resources WHERE org_id = '${orgId}' AND code = 'M.01'),
                '${projectId}', 'RAP', 40000, '2026-01-01')
      `);

      const estimate = await ahsp.getWorkItemEstimate(userId, projectId, workItemId);
      const [row] = await sql`
        SELECT total_rap FROM v_work_item_cost WHERE work_item_id = ${workItemId}
      `;

      // 8 zak lebih murah Rp8.000 x 100 m3 = Rp6.400.000 lebih rendah.
      expect(round2(row?.total_rap)).toBe('101465000.00');
      expect(round2(row?.total_rap)).toBe(estimate.totalRap);
    });
  });

  describe('template AHSP dan duplikasi', () => {
    let templates: typeof AhspTemplatesModule;
    let breakdown: typeof WorkBreakdownModule;

    beforeAll(async () => {
      [templates, breakdown] = await Promise.all([
        import('../ahsp-templates'),
        import('../work-breakdown'),
      ]);
    });

    it('menyimpan analisa sebagai template lalu menerapkannya ke pekerjaan lain', async () => {
      const template = await templates.saveTemplateFromWorkItem(user, projectId, workItemId, {
        code: 'TPL.K225',
        name: 'Beton K-225',
      });

      const target = await breakdown.createWorkItem(user, projectId, {
        code: 'A.02',
        name: 'Beton K-225 lantai 2',
        spec: null,
        groupId: null,
        unitId: (await sql`SELECT unit_id FROM work_items WHERE id = ${workItemId}`)[0]!.unit_id,
        volume: '50.0000',
        contractUnitPrice: '1250000.00',
        progressMethod: 'VOLUME',
        includeInProgressWeight: true,
        sortOrder: 1,
      });

      const applied = await templates.applyTemplate(user, projectId, target.id, template.id);
      expect(applied.added).toBe(ANALYSIS.length);
      expect(applied.skipped).toBe(0);

      // Same unit rate, half the volume, so half the total.
      const estimate = await ahsp.getWorkItemEstimate(userId, projectId, target.id);
      expect(estimate.unitCostRap).toBe('1078650.00');
      expect(estimate.totalRap).toBe('53932500.00');
    });

    it('melewati baris yang sudah ada alih-alih gagal di tengah', async () => {
      const template = await templates.saveTemplateFromWorkItem(user, projectId, workItemId, {
        code: 'TPL.DUP',
        name: 'Uji duplikat',
      });

      const again = await templates.applyTemplate(user, projectId, workItemId, template.id);
      expect(again.added).toBe(0);
      expect(again.skipped).toBe(ANALYSIS.length);

      const estimate = await ahsp.getWorkItemEstimate(userId, projectId, workItemId);
      expect(estimate.lines).toHaveLength(ANALYSIS.length);
    });

    it('mode REPLACE mengganti seluruh analisa', async () => {
      const template = await templates.saveTemplateFromWorkItem(user, projectId, workItemId, {
        code: 'TPL.REP',
        name: 'Uji ganti',
      });

      const replaced = await templates.applyTemplate(
        user, projectId, workItemId, template.id, 'REPLACE',
      );
      expect(replaced.removed).toBe(ANALYSIS.length);
      expect(replaced.added).toBe(ANALYSIS.length);

      const estimate = await ahsp.getWorkItemEstimate(userId, projectId, workItemId);
      expect(estimate.totalRap).toBe('107865000.00');
    });

    it('menolak menyimpan template dari pekerjaan tanpa analisa', async () => {
      const empty = await breakdown.createWorkItem(user, projectId, {
        code: 'A.99', name: 'Kosong', spec: null, groupId: null,
        unitId: (await sql`SELECT unit_id FROM work_items WHERE id = ${workItemId}`)[0]!.unit_id,
        volume: '1.0000', contractUnitPrice: null, progressMethod: 'VOLUME',
        includeInProgressWeight: true, sortOrder: 9,
      });

      await expect(
        templates.saveTemplateFromWorkItem(user, projectId, empty.id, {
          code: 'TPL.KOSONG', name: 'Kosong',
        }),
      ).rejects.toThrow(/belum memiliki baris analisa/i);
    });

    it('menduplikasi pekerjaan beserta analisanya', async () => {
      const copy = await breakdown.duplicateWorkItem(user, projectId, workItemId, {
        code: 'A.01-COPY',
        name: 'Beton K-225 (salinan)',
      });

      const original = await ahsp.getWorkItemEstimate(userId, projectId, workItemId);
      const duplicated = await ahsp.getWorkItemEstimate(userId, projectId, copy.id);

      expect(duplicated.lines).toHaveLength(original.lines.length);
      expect(duplicated.totalRap).toBe(original.totalRap);
      expect(duplicated.contractValue).toBe(original.contractValue);
    });

    // Progress and stock belong to the original; copying them would fabricate
    // history for work that has not been done.
    it('duplikasi tidak membawa serta catatan lapangan', async () => {
      const copy = await breakdown.duplicateWorkItem(user, projectId, workItemId, {
        code: 'A.01-COPY2',
        name: 'Salinan kedua',
      });

      const impact = await breakdown.getWorkItemDeletionImpact(userId, projectId, copy.id);
      expect(impact.progressEntries).toBe(0);
      expect(impact.materialTransactions).toBe(0);
      expect(impact.ahspLines).toBe(ANALYSIS.length);
    });

    it('menolak kode duplikat saat menyalin', async () => {
      await expect(
        breakdown.duplicateWorkItem(user, projectId, workItemId, {
          code: 'A.01',
          name: 'Bentrok',
        }),
      ).rejects.toThrow(/sudah dipakai/i);
    });
  });
});
