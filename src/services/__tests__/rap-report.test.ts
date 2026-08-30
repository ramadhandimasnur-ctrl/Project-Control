import { randomUUID } from 'node:crypto';

import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { connectionOptions } from '@/db/connection';

import type * as RapModule from '../rap-report';

/**
 * The operational report.
 *
 * One rule carries the whole document: an advance is not a cost. It is money
 * moved to a foreman before anything was measured, and it becomes cost when a
 * certificate says so. Counting it in both places would make a period look far
 * more expensive than it was, and the error compounds every time the advance
 * is recovered.
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
      WHERE table_schema = 'public' AND table_name = 'actual_costs'
    `;
    return rows[0]?.n === 1;
  } catch {
    return false;
  } finally {
    await probe.end();
  }
}

const ready = await schemaIsReady();
if (!ready) console.warn('[LAPORAN RAP] Dilewati: database belum tersedia.');

describe.skipIf(!ready)('laporan RAP operasional', () => {
  let sql: postgres.Sql;
  let service: typeof RapModule;

  const orgId = randomUUID();
  const userId = randomUUID();
  const projectId = randomUUID();
  const unitId = randomUUID();
  const resourceId = randomUUID();
  const warehouseId = randomUUID();
  const periodId = randomUUID();
  const otherPeriodId = randomUUID();
  const itemA = randomUUID();
  const subcontractId = randomUUID();

  const buildFixture = async (): Promise<void> => {
    await sql.unsafe(
      [
        'BEGIN',
        "SELECT set_config('app.bypass_rls', 'on', true)",
        "SELECT set_config('app.allow_hard_delete', 'on', true)",
        `DELETE FROM subcontract_certificates WHERE subcontract_id IN
           (SELECT id FROM subcontracts WHERE project_id = '${projectId}')`,
        `DELETE FROM projects WHERE org_id = '${orgId}'`,
        `DELETE FROM warehouses WHERE org_id = '${orgId}'`,
        `DELETE FROM resources WHERE org_id = '${orgId}'`,
        `DELETE FROM units WHERE org_id = '${orgId}'`,
        `DELETE FROM users WHERE org_id = '${orgId}'`,
        `DELETE FROM organizations WHERE id = '${orgId}'`,
        `INSERT INTO organizations (id, name) VALUES ('${orgId}', 'Org Laporan (uji)')`,
        `INSERT INTO users (id, org_id, email, full_name, global_role)
           VALUES ('${userId}', '${orgId}', 'laporan-${userId}@uji.test', 'Manajer Uji', 'ADMIN')`,
        `INSERT INTO units (id, org_id, code, name, dimension)
           VALUES ('${unitId}', '${orgId}', 'zak', 'zak', 'COUNT')`,
        `INSERT INTO resources (id, org_id, code, name, unit_id, type)
           VALUES ('${resourceId}', '${orgId}', 'M.01', 'Semen', '${unitId}', 'MATERIAL')`,
        `INSERT INTO projects (id, org_id, code, name, start_date, end_date)
           VALUES ('${projectId}', '${orgId}', 'LAP-1', 'Proyek Laporan', '2026-01-01', '2026-12-31')`,
        `INSERT INTO project_members (project_id, user_id, role)
           VALUES ('${projectId}', '${userId}', 'PROJECT_MANAGER')`,
        `INSERT INTO warehouses (id, project_id, name, is_default)
           VALUES ('${warehouseId}', '${projectId}', 'Gudang', true)`,
        `INSERT INTO schedule_periods (id, project_id, seq, period_type, label, start_date, end_date)
           VALUES ('${periodId}', '${projectId}', 1, 'WEEK', 'Minggu 1', '2026-01-01', '2026-01-07')`,
        `INSERT INTO schedule_periods (id, project_id, seq, period_type, label, start_date, end_date)
           VALUES ('${otherPeriodId}', '${projectId}', 2, 'WEEK', 'Minggu 2', '2026-01-08', '2026-01-14')`,
        `INSERT INTO work_items (id, project_id, code, name, unit_id, volume,
                                 unit_price_rab, unit_price_rap, sort_order)
           VALUES ('${itemA}', '${projectId}', 'A.01', 'Beton', '${unitId}', 100, 1000000, 800000, 0)`,
        `INSERT INTO subcontracts (id, project_id, party_name, scope, contract_value, status)
           VALUES ('${subcontractId}', '${projectId}', 'Mandor Slamet', 'Beton', 50000000, 'ACTIVE')`,
        'COMMIT',
      ].join(';\n'),
    ).simple();
  };

  beforeAll(async () => {
    sql = postgres(connectionOptions(url!, { max: 1, prepare: false, onnotice: () => {} }));
    service = await import('../rap-report');
  });

  beforeEach(buildFixture);

  afterAll(async () => {
    if (!sql) return;
    await sql.unsafe(`
      BEGIN;
      SELECT set_config('app.bypass_rls', 'on', true);
      SELECT set_config('app.allow_hard_delete', 'on', true);
      DELETE FROM subcontract_certificates WHERE subcontract_id IN
        (SELECT id FROM subcontracts WHERE project_id = '${projectId}');
      DELETE FROM projects WHERE org_id = '${orgId}';
      DELETE FROM warehouses WHERE org_id = '${orgId}';
      DELETE FROM resources WHERE org_id = '${orgId}';
      DELETE FROM units WHERE org_id = '${orgId}';
      DELETE FROM users WHERE org_id = '${orgId}';
      DELETE FROM organizations WHERE id = '${orgId}';
      COMMIT;
    `).simple();
    await sql.end();
  });

  const issueMaterial = (date: string, qty: string, unitCost: string) =>
    sql.unsafe(`
      INSERT INTO material_transactions
        (project_id, warehouse_id, resource_id, txn_type, txn_date, qty, unit_id, unit_cost, work_item_id)
      VALUES ('${projectId}', '${warehouseId}', '${resourceId}', 'OUT', '${date}',
              ${qty}, '${unitId}', ${unitCost}, '${itemA}')
    `);

  const certificate = (date: string, value: string) =>
    sql.unsafe(`
      INSERT INTO subcontract_certificates
        (subcontract_id, period_id, cert_no, cert_date, progress_value, advance_recouped,
         retention_withheld, net_payable, status)
      VALUES ('${subcontractId}', '${periodId}', 'SC-${date}', '${date}', ${value}, 0, 0, ${value}, 'APPROVED')
    `);

  const advance = (date: string, amount: string) =>
    sql.unsafe(`
      INSERT INTO subcontract_advances (subcontract_id, advance_date, amount)
      VALUES ('${subcontractId}', '${date}', ${amount})
    `);

  const booked = (date: string, amount: string) =>
    sql.unsafe(`
      INSERT INTO actual_costs (project_id, work_item_id, category, cost_date, amount, source_ref)
      VALUES ('${projectId}', '${itemA}', 'LABOR', '${date}', ${amount}, 'Upah harian')
    `);

  it('memilah pengeluaran menurut sumbernya', async () => {
    await issueMaterial('2026-01-03', '10', '50000');
    await certificate('2026-01-05', '3000000');
    await booked('2026-01-06', '1200000');

    const report = await service.getRapReport(userId, projectId, periodId);

    expect(report.material.total).toBe('500000.00');
    expect(report.subcontract.total).toBe('3000000.00');
    expect(report.booked.total).toBe('1200000.00');
    expect(report.totals.spentThisPeriod).toBe('4700000.00');
  });

  /*
   * The rule the whole report rests on. An advance appears, so cash going out
   * is visible, but it is not spent — the certificate that recovers it is.
   */
  it('mencantumkan kasbon tanpa menghitungnya sebagai biaya', async () => {
    await advance('2026-01-04', '9000000');

    const report = await service.getRapReport(userId, projectId, periodId);

    expect(report.advances.rows).toHaveLength(1);
    expect(report.advances.total).toBe('9000000.00');
    expect(report.totals.spentThisPeriod).toBe('0.00');
  });

  /*
   * A certificate already books its value into actual_costs on approval.
   * Listing that booking again under "recorded directly" would count the
   * foreman twice on the same sheet.
   */
  it('tidak menghitung ganda biaya yang berasal dari sertifikat', async () => {
    await certificate('2026-01-05', '3000000');
    await sql.unsafe(`
      INSERT INTO actual_costs
        (project_id, work_item_id, category, cost_date, amount, subcontract_certificate_id)
      SELECT '${projectId}', '${itemA}', 'SUBCON', '2026-01-05', 3000000, id
      FROM subcontract_certificates WHERE subcontract_id = '${subcontractId}'
    `);

    const report = await service.getRapReport(userId, projectId, periodId);

    expect(report.booked.rows).toHaveLength(0);
    expect(report.totals.spentThisPeriod).toBe('3000000.00');
  });

  it('membatasi diri pada tanggal periodenya', async () => {
    await issueMaterial('2026-01-03', '10', '50000');
    await issueMaterial('2026-01-10', '20', '50000');

    const week1 = await service.getRapReport(userId, projectId, periodId);
    const week2 = await service.getRapReport(userId, projectId, otherPeriodId);

    expect(week1.material.total).toBe('500000.00');
    expect(week2.material.total).toBe('1000000.00');
  });

  it('mengabaikan mutasi material yang dibatalkan', async () => {
    await issueMaterial('2026-01-03', '10', '50000');
    await sql.unsafe(`
      UPDATE material_transactions SET is_void = true, void_reason = 'salah catat'
      WHERE project_id = '${projectId}'
    `);

    const report = await service.getRapReport(userId, projectId, periodId);
    expect(report.material.total).toBe('0.00');
  });

  it('mengukur nilai yang dikerjakan pada RAP, bukan RAB', async () => {
    await sql.unsafe(`
      INSERT INTO progress_entries
        (project_id, work_item_id, period_id, entry_date, qty_this_period, pct_this_period, method, status)
      VALUES ('${projectId}', '${itemA}', '${periodId}', '2026-01-05', 0, 0.25, 'PERCENT', 'APPROVED')
    `);

    const report = await service.getRapReport(userId, projectId, periodId);

    // Seperempat dari RAP 80 juta, bukan dari RAB 100 juta.
    expect(report.totals.earnedThisPeriod).toBe('20000000.00');
    expect(report.progress.itemsWorked).toBe(1);
  });

  it('tidak memberi rasio pada periode tanpa pengeluaran', async () => {
    const report = await service.getRapReport(userId, projectId, periodId);
    expect(report.totals.ratio).toBeNull();
  });
});
