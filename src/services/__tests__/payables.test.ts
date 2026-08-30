import { randomUUID } from 'node:crypto';

import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { connectionOptions } from '@/db/connection';

import type * as PayablesModule from '../payables';

/**
 * What the project owes, across the documents that owe it.
 *
 * The risk here is not arithmetic, it is inclusion: a draft counted as a debt
 * makes a cash forecast plan around money nobody has committed, and a settled
 * invoice left in the overdue column buries the ones that still need paying.
 */

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ path: '.env', quiet: true });

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

async function schemaIsReady(): Promise<boolean> {
  if (!url) return false;
  const probe = postgres(connectionOptions(url, { max: 1, prepare: false, connect_timeout: 5 }));
  try {
    const rows = await probe`
      SELECT count(*)::int AS n FROM information_schema.views
      WHERE table_schema = 'public' AND table_name = 'v_payables'
    `;
    return rows[0]?.n === 1;
  } catch {
    return false;
  } finally {
    await probe.end();
  }
}

const ready = await schemaIsReady();
if (!ready) console.warn('[HUTANG] Dilewati: database belum tersedia.');

describe.skipIf(!ready)('buku hutang proyek', () => {
  let sql: postgres.Sql;
  let service: typeof PayablesModule;

  const orgId = randomUUID();
  const userId = randomUUID();
  const projectId = randomUUID();
  const supplierId = randomUUID();
  const subcontractId = randomUUID();
  const periodId = randomUUID();

  const buildFixture = async (): Promise<void> => {
    await sql.unsafe(
      [
        'BEGIN',
        "SELECT set_config('app.bypass_rls', 'on', true)",
        "SELECT set_config('app.allow_hard_delete', 'on', true)",
        `DELETE FROM subcontract_certificates WHERE subcontract_id IN (SELECT id FROM subcontracts WHERE project_id = '${projectId}')`,
        `DELETE FROM projects WHERE org_id = '${orgId}'`,
        `DELETE FROM suppliers WHERE org_id = '${orgId}'`,
        `DELETE FROM users WHERE org_id = '${orgId}'`,
        `DELETE FROM organizations WHERE id = '${orgId}'`,
        `INSERT INTO organizations (id, name) VALUES ('${orgId}', 'Org Hutang (uji)')`,
        `INSERT INTO users (id, org_id, email, full_name, global_role)
           VALUES ('${userId}', '${orgId}', 'hutang-${userId}@uji.test', 'Manajer Uji', 'ADMIN')`,
        `INSERT INTO suppliers (id, org_id, code, name)
           VALUES ('${supplierId}', '${orgId}', 'S.01', 'Toko Bangunan Jaya')`,
        `INSERT INTO projects (id, org_id, code, name, start_date, end_date)
           VALUES ('${projectId}', '${orgId}', 'HTG-1', 'Proyek Hutang', '2026-01-01', '2026-12-31')`,
        `INSERT INTO project_members (project_id, user_id, role)
           VALUES ('${projectId}', '${userId}', 'PROJECT_MANAGER')`,
        `INSERT INTO schedule_periods (id, project_id, seq, period_type, label, start_date, end_date)
           VALUES ('${periodId}', '${projectId}', 1, 'WEEK', 'Minggu 1', '2026-01-01', '2026-01-07')`,
        `INSERT INTO subcontracts (id, project_id, party_name, scope, contract_value, status)
           VALUES ('${subcontractId}', '${projectId}', 'CV Mitra Kerja', 'Pekerjaan atap', 50000000, 'ACTIVE')`,
        'COMMIT',
      ].join(';\n'),
    ).simple();
  };

  /*
   * The purchase date is derived from the due date rather than fixed: the
   * database refuses terms that fall due before the invoice was raised, which
   * is right, and a fixture that fights that constraint is testing nothing.
   */
  const purchase = (
    poNo: string,
    total: string,
    dueDate: string,
    status: 'DRAFT' | 'POSTED',
    paidAt: string | null = null,
  ) =>
    sql.unsafe(`
      INSERT INTO purchases (project_id, supplier_id, po_no, purchase_date, due_date, status,
                             subtotal, vat_amount, total_amount, paid_at)
      VALUES ('${projectId}', '${supplierId}', '${poNo}', '${dueDate}'::date - 30, '${dueDate}', '${status}',
              ${total}, 0, ${total}, ${paidAt === null ? 'NULL' : `'${paidAt}'`})
    `);

  const certificate = (certNo: string, net: string, status: 'DRAFT' | 'APPROVED') =>
    sql.unsafe(`
      INSERT INTO subcontract_certificates
        (subcontract_id, period_id, cert_no, cert_date, progress_value, advance_recouped,
         retention_withheld, net_payable, status)
      VALUES ('${subcontractId}', '${periodId}', '${certNo}', '2026-01-10', ${net}, 0, 0, ${net}, '${status}')
    `);

  beforeAll(async () => {
    sql = postgres(connectionOptions(url!, { max: 1, prepare: false, onnotice: () => {} }));
    service = await import('../payables');
  });

  beforeEach(buildFixture);

  afterAll(async () => {
    if (!sql) return;
    await sql.unsafe(`
      BEGIN;
      SELECT set_config('app.bypass_rls', 'on', true);
      SELECT set_config('app.allow_hard_delete', 'on', true);
      DELETE FROM subcontract_certificates WHERE subcontract_id IN (SELECT id FROM subcontracts WHERE project_id = '${projectId}');
      DELETE FROM projects WHERE org_id = '${orgId}';
      DELETE FROM suppliers WHERE org_id = '${orgId}';
      DELETE FROM users WHERE org_id = '${orgId}';
      DELETE FROM organizations WHERE id = '${orgId}';
      COMMIT;
    `).simple();
    await sql.end();
  });

  it('mengumpulkan pembelian dan sertifikat subkon dalam satu daftar', async () => {
    await purchase('PO-1', '10000000', '2026-02-01', 'POSTED');
    await certificate('SC-1', '20000000', 'APPROVED');

    const { rows, totals } = await service.getPayables(userId, projectId, { today: '2026-01-15' });

    expect(rows.map((r) => r.sourceType).sort()).toEqual(['PURCHASE', 'SUBCONTRACT']);
    expect(totals.outstanding).toBe('30000000.00');
  });

  /*
   * A purchase order still being typed is not a debt. Counting it would have
   * the project forecasting around money it has not committed to spend.
   */
  it('mengabaikan dokumen yang masih draf', async () => {
    await purchase('PO-DRAFT', '99000000', '2026-02-01', 'DRAFT');
    await certificate('SC-DRAFT', '88000000', 'DRAFT');

    const { rows, totals } = await service.getPayables(userId, projectId, { today: '2026-01-15' });

    expect(rows).toHaveLength(0);
    expect(totals.outstanding).toBe('0.00');
  });

  it('memisahkan yang lewat jatuh tempo dari yang masih terjadwal', async () => {
    await purchase('PO-LATE', '5000000', '2026-01-01', 'POSTED');
    await purchase('PO-SOON', '3000000', '2026-02-01', 'POSTED');
    await purchase('PO-LATER', '7000000', '2026-06-01', 'POSTED');

    const { rows, totals } = await service.getPayables(userId, projectId, { today: '2026-01-15' });

    const byRef = new Map(rows.map((r) => [r.reference, r]));
    expect(byRef.get('PO-LATE')?.bucket).toBe('OVERDUE');
    expect(byRef.get('PO-LATE')?.daysUntilDue).toBe(-14);
    expect(byRef.get('PO-SOON')?.bucket).toBe('DUE_SOON');
    expect(byRef.get('PO-LATER')?.bucket).toBe('SCHEDULED');

    expect(totals.overdue).toBe('5000000.00');
    expect(totals.dueWithin30).toBe('3000000.00');
    expect(totals.outstanding).toBe('15000000.00');
  });

  /*
   * An invoice settled after its due date is history, not a debt. Leaving it
   * red for ever would bury the ones that still need attention.
   */
  it('tidak menyebut hutang yang sudah dibayar sebagai terlambat', async () => {
    await purchase('PO-PAID', '4000000', '2026-01-01', 'POSTED', '2026-01-10');

    const { rows, totals } = await service.getPayables(userId, projectId, { today: '2026-01-15' });

    expect(rows[0]?.bucket).toBe('PAID');
    expect(rows[0]?.paidAt).toBe('2026-01-10');
    expect(totals.overdue).toBe('0.00');
    expect(totals.outstanding).toBe('0.00');
    expect(totals.paid).toBe('4000000.00');
  });

  // A supplier who agreed no terms still has to appear; it just cannot be aged.
  it('menampilkan kewajiban tanpa tanggal jatuh tempo sebagai belum bertanggal', async () => {
    await certificate('SC-2', '6000000', 'APPROVED');

    const { rows, totals } = await service.getPayables(userId, projectId, { today: '2026-01-15' });

    expect(rows[0]?.bucket).toBe('UNDATED');
    expect(rows[0]?.daysUntilDue).toBeNull();
    expect(totals.outstanding).toBe('6000000.00');
    expect(totals.overdue).toBe('0.00');
  });
});
