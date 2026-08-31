import { randomUUID } from 'node:crypto';

import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { connectionOptions } from '@/db/connection';

import type * as CostsModule from '../costs';
import type { SessionUser } from '../session';
import { guardDatabase, probeSchema } from './_support/schema-probe';

/**
 * Cost control at the level of a work item.
 *
 * The point of this table is a number the project could not produce before:
 * what one item has actually cost. Two things could make it wrong and neither
 * would announce itself — material counted twice because it is recorded both
 * as an issue and as a booking, and a comparison made against the whole plan
 * rather than against the part of it that has been earned. Both are checked.
 */

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ path: '.env', quiet: true });

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

const probe = await probeSchema('BIAYA', async (db) => {
  const rows = await db`
    SELECT count(*)::int AS n FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'actual_costs'
  `;
  const views = await db`
    SELECT count(*)::int AS n FROM information_schema.views
    WHERE table_schema = 'public' AND table_name = 'v_work_item_actual_cost'
  `;
  return rows[0]?.n === 1 && views[0]?.n === 1;
});

// A configured database that cannot be reached is a failure, not a skip:
// a suite that verified nothing must not look as though it had.
guardDatabase('BIAYA', probe);
const ready = probe.ready;

describe.skipIf(!ready)('kendali biaya per pekerjaan', () => {
  let sql: postgres.Sql;
  let service: typeof CostsModule;

  const orgId = randomUUID();
  const userId = randomUUID();
  const projectId = randomUUID();
  const unitId = randomUUID();
  const warehouseId = randomUUID();
  const resourceId = randomUUID();
  const periodId = randomUUID();
  const itemA = randomUUID();
  const itemB = randomUUID();

  const user: SessionUser = {
    id: userId,
    orgId,
    email: `biaya-${userId}@uji.test`,
    fullName: 'Manajer Uji',
    globalRole: 'ADMIN',
  };

  /*
   * Item A is priced by a typed unit rate rather than an AHSP, so the fixture
   * does not have to build an analysis to have a RAP worth comparing against.
   * 100 x 1.000.000 sold, 100 x 800.000 planned.
   */
  const buildFixture = async (): Promise<void> => {
    await sql.unsafe(
      [
        'BEGIN',
        "SELECT set_config('app.bypass_rls', 'on', true)",
        "SELECT set_config('app.allow_hard_delete', 'on', true)",
        `DELETE FROM projects WHERE org_id = '${orgId}'`,
        `DELETE FROM resources WHERE org_id = '${orgId}'`,
        `DELETE FROM units WHERE org_id = '${orgId}'`,
        `DELETE FROM users WHERE org_id = '${orgId}'`,
        `DELETE FROM organizations WHERE id = '${orgId}'`,
        `INSERT INTO organizations (id, name) VALUES ('${orgId}', 'Org Biaya (uji)')`,
        `INSERT INTO users (id, org_id, email, full_name, global_role)
           VALUES ('${userId}', '${orgId}', '${user.email}', '${user.fullName}', 'ADMIN')`,
        `INSERT INTO units (id, org_id, code, name, dimension)
           VALUES ('${unitId}', '${orgId}', 'm3', 'meter kubik', 'VOLUME')`,
        `INSERT INTO resources (id, org_id, code, name, unit_id, type)
           VALUES ('${resourceId}', '${orgId}', 'M.01', 'Semen', '${unitId}', 'MATERIAL')`,
        `INSERT INTO projects (id, org_id, code, name, start_date, end_date, contract_value)
           VALUES ('${projectId}', '${orgId}', 'BIAYA-1', 'Proyek Biaya',
                   '2026-01-01', '2026-12-31', 100000000)`,
        `INSERT INTO project_members (project_id, user_id, role)
           VALUES ('${projectId}', '${userId}', 'PROJECT_MANAGER')`,
        `INSERT INTO warehouses (id, project_id, name, is_default)
           VALUES ('${warehouseId}', '${projectId}', 'Gudang Utama', true)`,
        `INSERT INTO schedule_periods (id, project_id, seq, period_type, label, start_date, end_date)
           VALUES ('${periodId}', '${projectId}', 1, 'WEEK', 'Minggu 1', '2026-01-01', '2026-01-07')`,
        `INSERT INTO work_items (id, project_id, code, name, unit_id, volume,
                                 contract_unit_price, unit_price_rab, unit_price_rap, sort_order)
           VALUES ('${itemA}', '${projectId}', 'A.01', 'Galian', '${unitId}', 100,
                   1000000, 1000000, 800000, 0)`,
        `INSERT INTO work_items (id, project_id, code, name, unit_id, volume,
                                 contract_unit_price, unit_price_rab, unit_price_rap, sort_order)
           VALUES ('${itemB}', '${projectId}', 'A.02', 'Urugan', '${unitId}', 50,
                   500000, 500000, 400000, 1)`,
        'COMMIT',
      ].join(';\n'),
    ).simple();
  };

  beforeAll(async () => {
    sql = postgres(connectionOptions(url!, { max: 1, prepare: false, onnotice: () => {} }));
    service = await import('../costs');
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

  /** Approves a share of an item, which is what turns plan into earned value. */
  const approve = (workItemId: string, fraction: string) =>
    sql.unsafe(`
      INSERT INTO progress_entries
        (project_id, work_item_id, period_id, entry_date, qty_this_period, pct_this_period, method, status)
      VALUES ('${projectId}', '${workItemId}', '${periodId}', '2026-01-05', 0, ${fraction}, 'PERCENT', 'APPROVED')
    `);

  const issue = (workItemId: string, qty: string, unitCost: string) =>
    sql.unsafe(`
      INSERT INTO material_transactions
        (project_id, warehouse_id, resource_id, txn_type, txn_date, qty, unit_id, unit_cost, work_item_id)
      VALUES ('${projectId}', '${warehouseId}', '${resourceId}', 'OUT', '2026-01-05',
              ${qty}, '${unitId}', ${unitCost}, '${workItemId}')
    `);

  const book = (workItemId: string | null, amount: string) =>
    service.saveActualCost(user, projectId, null, {
      costDate: '2026-01-06',
      workItemId: workItemId ?? '',
      resourceId: '',
      category: 'LABOR',
      qty: null,
      unitCost: null,
      amount,
      sourceRef: null,
      note: null,
    });

  it('membaca RAB dan RAP per pekerjaan', async () => {
    const control = await service.getCostControl(userId, projectId);

    const a = control.rows.find((r) => r.code === 'A.01');
    expect(a?.totalRab).toBe('100000000.00');
    expect(a?.totalRap).toBe('80000000.00');
    expect(control.totals.totalRap).toBe('100000000.00');
  });

  /*
   * The two sources have to add up and stay distinguishable. If issues were
   * also bookable by hand the same material would land twice, which is why
   * `actual_costs` holds no material and the view labels what it does hold.
   */
  it('menjumlahkan material keluar dan biaya yang dicatat, tanpa menghitung dua kali', async () => {
    await issue(itemA, '10', '1500000');
    await book(itemA, '5000000');

    const control = await service.getCostControl(userId, projectId);
    const a = control.rows.find((r) => r.code === 'A.01');

    expect(a?.actualIssued).toBe('15000000.00');
    expect(a?.actualBooked).toBe('5000000.00');
    expect(a?.actual).toBe('20000000.00');
  });

  it('mengabaikan mutasi material yang dibatalkan', async () => {
    await issue(itemA, '10', '1500000');
    await sql.unsafe(`UPDATE material_transactions SET is_void = true, void_reason = 'salah catat' WHERE project_id = '${projectId}'`);

    const control = await service.getCostControl(userId, projectId);
    expect(control.rows.find((r) => r.code === 'A.01')?.actual).toBe('0.00');
  });

  /*
   * The comparison that matters. A quarter of an 80 juta plan is 20 juta of
   * earned value; spending 25 juta to get there is 5 juta over, and a CPI of
   * 0,8 — not the 0,3125 that comparing against the whole plan would suggest.
   */
  it('mengukur biaya terhadap bagian rencana yang sudah dikerjakan', async () => {
    await approve(itemA, '0.25');
    await book(itemA, '25000000');

    const a = (await service.getCostControl(userId, projectId)).rows.find((r) => r.code === 'A.01');

    expect(a?.completion).toBe('0.25');
    expect(a?.earned).toBe('20000000.00');
    expect(a?.variance).toBe('-5000000.00');
    expect(a?.cpi).toBe('0.8000');
    // At this burn rate the whole item lands at 100 juta against a plan of 80.
    expect(a?.forecast).toBe('100000000.00');
  });

  it('tidak memberi nilai CPI pada pekerjaan yang belum mengeluarkan biaya', async () => {
    await approve(itemA, '0.5');
    const a = (await service.getCostControl(userId, projectId)).rows.find((r) => r.code === 'A.01');

    // Spending nothing is not a perfect score; it is no score.
    expect(a?.cpi).toBeNull();
    expect(a?.forecast).toBe('0.00');
  });

  it('tidak meramalkan dari pekerjaan yang belum dimulai', async () => {
    await book(itemA, '1000000');
    const a = (await service.getCostControl(userId, projectId)).rows.find((r) => r.code === 'A.01');
    expect(a?.forecast).toBeNull();
  });

  /*
   * A site overhead belongs to the project and to no single item. It has to be
   * recordable, and it must not be attributed to whichever item happened to be
   * first in the list.
   */
  it('menerima biaya yang tidak terikat pada satu pekerjaan', async () => {
    await book(null, '3000000');

    const control = await service.getCostControl(userId, projectId);
    expect(control.rows.every((r) => r.actual === '0.00')).toBe(true);

    const ledger = await service.listActualCosts(userId, projectId);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.workItemId).toBeNull();
    expect(ledger[0]?.amount).toBe('3000000.00');
  });

  it('menurunkan jumlah dari kuantitas dan harga satuan bila jumlahnya tidak diisi', async () => {
    await service.saveActualCost(user, projectId, null, {
      costDate: '2026-01-06',
      workItemId: itemA,
      resourceId: '',
      category: 'EQUIPMENT',
      qty: '3',
      unitCost: '750000',
      amount: null,
      sourceRef: null,
      note: null,
    });

    const a = (await service.getCostControl(userId, projectId)).rows.find((r) => r.code === 'A.01');
    expect(a?.actualBooked).toBe('2250000.00');
  });

  it('menolak biaya yang tidak dapat dihitung sama sekali', async () => {
    await expect(
      service.saveActualCost(user, projectId, null, {
        costDate: '2026-01-06',
        workItemId: itemA,
        resourceId: '',
        category: 'LABOR',
        qty: null,
        unitCost: null,
        amount: null,
        sourceRef: null,
        note: null,
      }),
    ).rejects.toThrow(/belum dapat dihitung/);
  });

  it('menghapus biaya yang dicatat', async () => {
    const { id } = await book(itemA, '4000000');
    await service.deleteActualCost(user, projectId, id);

    expect(await service.listActualCosts(userId, projectId)).toHaveLength(0);
  });

  /*
   * Bought against installed. The remainder is stock, not loss — but it is the
   * number that says whether the two are drifting apart.
   */
  it('membandingkan yang dibeli dengan yang terpasang', async () => {
    await sql.unsafe(`
      INSERT INTO material_transactions
        (project_id, warehouse_id, resource_id, txn_type, txn_date, qty, unit_id, unit_cost)
      VALUES ('${projectId}', '${warehouseId}', '${resourceId}', 'IN', '2026-01-02', 100, '${unitId}', 1000000)
    `);
    await issue(itemA, '40', '1000000');

    const { rows } = await service.getPurchasedVsUsed(userId, projectId);
    const semen = rows.find((r) => r.code === 'M.01');

    expect(semen?.qtyIn).toBe('100.0000');
    expect(semen?.qtyOut).toBe('40.0000');
    expect(semen?.qtyRemaining).toBe('60.0000');
    expect(semen?.avgPriceIn).toBe('1000000.00');
    expect(semen?.usedFraction).toBe('0.4000');
  });
});
