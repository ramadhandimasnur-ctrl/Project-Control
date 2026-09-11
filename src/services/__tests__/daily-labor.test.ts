import { randomUUID } from 'node:crypto';

import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { connectionOptions } from '@/db/connection';

import type * as LaborModule from '../daily-labor';
import type { SessionUser } from '../session';
import { guardDatabase, probeSchema } from './_support/schema-probe';

/**
 * Day-rate labour.
 *
 * Three things decide whether the numbers are usable: the day must multiply
 * out the same way every time, the split across work items must not exceed the
 * day that was worked, and whatever nobody attributed must still count as
 * money spent. The last one is the easiest to get wrong and the one that makes
 * a project look cheaper than it was.
 */

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ path: '.env', quiet: true });

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

const probe = await probeSchema('UPAH HARIAN', async (db) => {
  const rows = await db`
    SELECT count(*)::int AS n FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN ('daily_labor', 'daily_labor_lines', 'foremen')
  `;
  return rows[0]?.n === 3;
});

guardDatabase('UPAH HARIAN', probe);
const ready = probe.ready;

describe.skipIf(!ready)('upah harian', () => {
  let sql: postgres.Sql;
  let service: typeof LaborModule;

  const orgId = randomUUID();
  const userId = randomUUID();
  const projectId = randomUUID();
  const unitId = randomUUID();
  const periodId = randomUUID();
  const itemA = randomUUID();
  const itemB = randomUUID();

  const user: SessionUser = {
    id: userId,
    orgId,
    email: `harian-${userId}@uji.test`,
    fullName: 'Manajer Uji',
    globalRole: 'ADMIN',
  };

  const buildFixture = async (): Promise<void> => {
    await sql.unsafe(
      [
        'BEGIN',
        "SELECT set_config('app.bypass_rls', 'on', true)",
        "SELECT set_config('app.allow_hard_delete', 'on', true)",
        `DELETE FROM projects WHERE org_id = '${orgId}'`,
        `DELETE FROM foremen WHERE org_id = '${orgId}'`,
        `DELETE FROM units WHERE org_id = '${orgId}'`,
        `DELETE FROM users WHERE org_id = '${orgId}'`,
        `DELETE FROM organizations WHERE id = '${orgId}'`,
        `INSERT INTO organizations (id, name) VALUES ('${orgId}', 'Org Harian (uji)')`,
        `INSERT INTO users (id, org_id, email, full_name, global_role)
           VALUES ('${userId}', '${orgId}', '${user.email}', '${user.fullName}', 'ADMIN')`,
        `INSERT INTO units (id, org_id, code, name, dimension)
           VALUES ('${unitId}', '${orgId}', 'm2', 'meter persegi', 'AREA')`,
        `INSERT INTO projects (id, org_id, code, name, start_date, end_date)
           VALUES ('${projectId}', '${orgId}', 'HRN-1', 'Proyek Harian', '2026-01-01', '2026-12-31')`,
        `INSERT INTO project_members (project_id, user_id, role)
           VALUES ('${projectId}', '${userId}', 'PROJECT_MANAGER')`,
        `INSERT INTO schedule_periods (id, project_id, seq, period_type, label, start_date, end_date)
           VALUES ('${periodId}', '${projectId}', 1, 'WEEK', 'Minggu 1', '2026-01-01', '2026-01-07')`,
        `INSERT INTO work_items (id, project_id, code, name, unit_id, volume, sort_order)
           VALUES ('${itemA}', '${projectId}', 'A.01', 'Pasang keramik', '${unitId}', 500, 0)`,
        `INSERT INTO work_items (id, project_id, code, name, unit_id, volume, sort_order)
           VALUES ('${itemB}', '${projectId}', 'A.02', 'Plester dinding', '${unitId}', 300, 1)`,
        'COMMIT',
      ].join(';\n'),
    ).simple();
  };

  beforeAll(async () => {
    sql = postgres(connectionOptions(url!, { max: 1, prepare: false, onnotice: () => {} }));
    service = await import('../daily-labor');
  });

  beforeEach(buildFixture);

  afterAll(async () => {
    if (!sql) return;
    await sql.unsafe(`
      BEGIN;
      SELECT set_config('app.bypass_rls', 'on', true);
      SELECT set_config('app.allow_hard_delete', 'on', true);
      DELETE FROM projects WHERE org_id = '${orgId}';
      DELETE FROM foremen WHERE org_id = '${orgId}';
      DELETE FROM units WHERE org_id = '${orgId}';
      DELETE FROM users WHERE org_id = '${orgId}';
      DELETE FROM organizations WHERE id = '${orgId}';
      COMMIT;
    `).simple();
    await sql.end();
  });

  /** Four workers, half a day and a bit, at Rp150.000 — the figures from the workbook. */
  const aDay = (
    lines: { workItemId: string | null; personDays: string }[] = [],
    over: Partial<LaborModule.DailyLaborInput> = {},
  ) =>
    service.saveDailyLabor(user, projectId, null, {
      workDate: '2026-01-05',
      periodId,
      foremanId: null,
      workerCount: 4,
      dayFraction: '0.5625',
      dailyRate: '150000',
      note: null,
      lines: lines.map((line) => ({ ...line, qtyOutput: null, note: null })),
      ...over,
    });

  it('mengalikan jumlah pekerja, bagian hari, dan tarif', async () => {
    const { grossAmount } = await aDay();

    // 4 x 0,5625 = 2,25 hari-orang; 2,25 x 150.000 = 337.500
    expect(grossAmount).toBe('337500.00');

    const { rows } = await service.listDailyLabor(userId, projectId);
    expect(rows[0]?.personDays).toBe('2.2500');
  });

  it('membagi biaya ke pekerjaan menurut hari-orang', async () => {
    const { id } = await aDay([
      { workItemId: itemA, personDays: '1.5' },
      { workItemId: itemB, personDays: '0.75' },
    ]);

    const detail = await service.getDailyLabor(userId, projectId, id);
    const byCode = new Map(detail.lines.map((l) => [l.workItemCode, l]));

    expect(byCode.get('A.01')?.allocatedCost).toBe('225000.00');
    expect(byCode.get('A.02')?.allocatedCost).toBe('112500.00');
    expect(detail.unallocatedPersonDays).toBe('0.0000');
  });

  /*
   * Over-allocation is somebody counting the same crew on two items. Refused
   * rather than scaled down, because scaling silently changes what the record
   * says happened.
   */
  it('menolak pembagian melebihi hari-orang yang tercatat', async () => {
    await expect(
      aDay([
        { workItemId: itemA, personDays: '2' },
        { workItemId: itemB, personDays: '1' },
      ]),
    ).rejects.toThrow(/melebihi/);
  });

  it('melaporkan sisa hari-orang yang belum dibagi', async () => {
    const { id } = await aDay([{ workItemId: itemA, personDays: '1' }]);
    const detail = await service.getDailyLabor(userId, projectId, id);

    expect(detail.allocatedPersonDays).toBe('1.0000');
    expect(detail.unallocatedPersonDays).toBe('1.2500');
  });

  it('membukukan biaya ke pekerjaan saat disetujui', async () => {
    const { id } = await aDay([
      { workItemId: itemA, personDays: '1.5' },
      { workItemId: itemB, personDays: '0.75' },
    ]);
    await service.approveDailyLabor(user, projectId, id);

    const costs = await import('../costs');
    const control = await costs.getCostControl(userId, projectId);

    expect(control.rows.find((r) => r.code === 'A.01')?.actualBooked).toBe('225000.00');
    expect(control.rows.find((r) => r.code === 'A.02')?.actualBooked).toBe('112500.00');
  });

  /*
   * The part nobody attributed still left the account. Dropping it would make
   * the project look cheaper than it was, which is the failure this whole
   * ledger exists to prevent.
   */
  it('tetap membukukan sisa yang tidak dibagi, tanpa pekerjaan', async () => {
    const { id } = await aDay([{ workItemId: itemA, personDays: '1' }]);
    await service.approveDailyLabor(user, projectId, id);

    const rows = await sql<{ work_item_id: string | null; amount: string }[]>`
      SELECT work_item_id, amount::text FROM actual_costs WHERE project_id = ${projectId}
      ORDER BY work_item_id NULLS LAST
    `;

    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.work_item_id === itemA)?.amount).toBe('150000.00');
    // 337.500 − 150.000 = 187.500 yang tidak menempel ke pekerjaan mana pun.
    expect(rows.find((r) => r.work_item_id === null)?.amount).toBe('187500.00');
  });

  it('tidak menggandakan biaya bila disetujui dua kali', async () => {
    const { id } = await aDay([{ workItemId: itemA, personDays: '2.25' }]);
    await service.approveDailyLabor(user, projectId, id);
    await service.approveDailyLabor(user, projectId, id);

    const costs = await import('../costs');
    const control = await costs.getCostControl(userId, projectId);
    expect(control.rows.find((r) => r.code === 'A.01')?.actualBooked).toBe('337500.00');
  });

  it('menghapus biaya yang dibukukan ketika catatannya dihapus', async () => {
    const { id } = await aDay([{ workItemId: itemA, personDays: '2.25' }]);
    await service.approveDailyLabor(user, projectId, id);
    await service.deleteDailyLabor(user, projectId, id);

    const costs = await import('../costs');
    const control = await costs.getCostControl(userId, projectId);
    expect(control.rows.find((r) => r.code === 'A.01')?.actualBooked).toBe('0.00');
  });

  it('menolak mencatat pembayaran sebelum disetujui', async () => {
    const { id } = await aDay();
    await expect(
      service.markDailyLaborPaid(user, projectId, id, {
        paidAt: '2026-01-06',
        paymentMethod: 'tunai',
        refNo: null,
      }),
    ).rejects.toThrow(/belum disetujui/);
  });

  it('menolak mengubah catatan yang sudah dibayar', async () => {
    const { id } = await aDay();
    await service.approveDailyLabor(user, projectId, id);
    await service.markDailyLaborPaid(user, projectId, id, {
      paidAt: '2026-01-06',
      paymentMethod: 'tunai',
      refNo: null,
    });

    await expect(
      service.saveDailyLabor(user, projectId, id, {
        workDate: '2026-01-05',
        periodId,
        foremanId: null,
        workerCount: 9,
        dayFraction: '1',
        dailyRate: '150000',
        note: null,
        lines: [],
      }),
    ).rejects.toThrow(/sudah dibayar/);
  });

  it('menautkan catatan ke mandor dari daftar master', async () => {
    const { id: foremanId } = await service.saveForeman(user, null, {
      code: 'MDR-01',
      name: 'Supri',
      phone: '0812',
      address: null,
      bankAccount: '1234567890',
      isActive: true,
      note: null,
    });

    await aDay([], { foremanId });

    const { rows } = await service.listDailyLabor(userId, projectId);
    expect(rows[0]?.foremanName).toBe('Supri');
  });
});
