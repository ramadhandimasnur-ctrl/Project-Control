import { randomUUID } from 'node:crypto';

import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { connectionOptions } from '@/db/connection';

import type * as PlanModule from '../procurement-plan';

/**
 * When each material has to be ordered.
 *
 * The arithmetic is small and the consequence of getting it wrong is not: an
 * order date a week late is a site standing still. What is checked here is the
 * subtraction itself, the refusal to invent a date for unscheduled work, and
 * the boundary where a row starts calling itself late.
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
      WHERE table_schema = 'public' AND table_name = 'v_material_requirement'
    `;
    return rows[0]?.n === 1;
  } catch {
    return false;
  } finally {
    await probe.end();
  }
}

const ready = await schemaIsReady();
if (!ready) console.warn('[PENGADAAN] Dilewati: database belum tersedia.');

describe.skipIf(!ready)('rencana pengadaan', () => {
  let sql: postgres.Sql;
  let service: typeof PlanModule;

  const orgId = randomUUID();
  const userId = randomUUID();
  const projectId = randomUUID();
  const unitId = randomUUID();
  const semenId = randomUUID();
  const pasirId = randomUUID();
  const itemA = randomUUID();

  /*
   * One work item planned to start on 1 June, consuming two materials with
   * different lead times: cement at 21 days, sand at 3. With a seven-day
   * buffer that is 1 June minus 28 and minus 10 — 4 May and 22 May.
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
        `INSERT INTO organizations (id, name) VALUES ('${orgId}', 'Org Pengadaan (uji)')`,
        `INSERT INTO users (id, org_id, email, full_name, global_role)
           VALUES ('${userId}', '${orgId}', 'pengadaan-${userId}@uji.test', 'Manajer Uji', 'ADMIN')`,
        `INSERT INTO units (id, org_id, code, name, dimension)
           VALUES ('${unitId}', '${orgId}', 'zak', 'zak', 'COUNT')`,
        `INSERT INTO resources (id, org_id, code, name, unit_id, type, lead_time_days)
           VALUES ('${semenId}', '${orgId}', 'M.01', 'Semen', '${unitId}', 'MATERIAL', 21)`,
        `INSERT INTO resources (id, org_id, code, name, unit_id, type, lead_time_days)
           VALUES ('${pasirId}', '${orgId}', 'M.02', 'Pasir', '${unitId}', 'MATERIAL', 3)`,
        `INSERT INTO projects (id, org_id, code, name, start_date, end_date)
           VALUES ('${projectId}', '${orgId}', 'PGD-1', 'Proyek Pengadaan', '2026-01-01', '2026-12-31')`,
        `INSERT INTO project_members (project_id, user_id, role)
           VALUES ('${projectId}', '${userId}', 'PROJECT_MANAGER')`,
        `INSERT INTO work_items (id, project_id, code, name, unit_id, volume, sort_order)
           VALUES ('${itemA}', '${projectId}', 'A.01', 'Beton', '${unitId}', 100, 0)`,
        `INSERT INTO work_item_resources (work_item_id, resource_id, role, estimate_type, coef)
           VALUES ('${itemA}', '${semenId}', 'MATERIAL', 'RAP', 8)`,
        `INSERT INTO work_item_resources (work_item_id, resource_id, role, estimate_type, coef)
           VALUES ('${itemA}', '${pasirId}', 'MATERIAL', 'RAP', 0.5)`,
        'COMMIT',
      ].join(';\n'),
    ).simple();
  };

  const schedule = (start: string) =>
    sql.unsafe(`
      INSERT INTO work_item_schedules (work_item_id, planned_start, planned_finish, duration_days)
      VALUES ('${itemA}', '${start}', '${start}'::date + 30, 30)
    `);

  beforeAll(async () => {
    sql = postgres(connectionOptions(url!, { max: 1, prepare: false, onnotice: () => {} }));
    service = await import('../procurement-plan');
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

  it('mengurangi lead time dan buffer dari tanggal mulai pekerjaan', async () => {
    await schedule('2026-06-01');

    const { rows } = await service.getProcurementPlan(userId, projectId, { today: '2026-01-01' });
    const semen = rows.find((r) => r.code === 'M.01');
    const pasir = rows.find((r) => r.code === 'M.02');

    expect(semen?.neededBy).toBe('2026-06-01');
    expect(semen?.orderBy).toBe('2026-05-04'); // 21 + 7 hari sebelumnya
    expect(pasir?.orderBy).toBe('2026-05-22'); // 3 + 7 hari sebelumnya
  });

  it('menghormati buffer yang diminta pemanggil', async () => {
    await schedule('2026-06-01');

    const { rows, bufferDays } = await service.getProcurementPlan(userId, projectId, {
      bufferDays: 0,
      today: '2026-01-01',
    });

    expect(bufferDays).toBe(0);
    expect(rows.find((r) => r.code === 'M.01')?.orderBy).toBe('2026-05-11');
  });

  /*
   * A material nothing has scheduled has no order date. Giving it today's date
   * would look like an answer, and a made-up deadline is worse than an admitted
   * gap because nobody questions it.
   */
  it('tidak mengarang tanggal untuk pekerjaan yang belum dijadwalkan', async () => {
    const { rows } = await service.getProcurementPlan(userId, projectId, { today: '2026-01-01' });

    expect(rows.every((r) => r.orderBy === null)).toBe(true);
    expect(rows.every((r) => r.urgency === 'UNSCHEDULED')).toBe(true);
  });

  it('menandai yang sudah lewat tanggal pesan sebagai terlambat', async () => {
    await schedule('2026-06-01');

    const { rows } = await service.getProcurementPlan(userId, projectId, { today: '2026-05-10' });
    // Semen seharusnya dipesan 4 Mei; hari ini 10 Mei.
    expect(rows.find((r) => r.code === 'M.01')?.urgency).toBe('LATE');
    expect(rows.find((r) => r.code === 'M.01')?.daysUntilOrder).toBe(-6);
    // Pasir masih 12 hari lagi.
    expect(rows.find((r) => r.code === 'M.02')?.urgency).toBe('PLANNED');
  });

  it('menandai yang tinggal sepekan lagi sebagai segera', async () => {
    await schedule('2026-06-01');

    const { rows } = await service.getProcurementPlan(userId, projectId, { today: '2026-05-16' });
    expect(rows.find((r) => r.code === 'M.02')?.urgency).toBe('SOON');
  });

  /*
   * Something already bought in full is not something to order. It belongs on
   * the material schedule, which reports stock, not on a list of deadlines.
   */
  it('mengeluarkan material yang kebutuhannya sudah terbeli seluruhnya', async () => {
    const warehouseId = randomUUID();
    await sql.unsafe(`
      INSERT INTO warehouses (id, project_id, name, is_default)
        VALUES ('${warehouseId}', '${projectId}', 'Gudang', true);
      INSERT INTO material_transactions
        (project_id, warehouse_id, resource_id, txn_type, txn_date, qty, unit_id, unit_cost)
      VALUES ('${projectId}', '${warehouseId}', '${semenId}', 'IN', '2026-01-02', 800, '${unitId}', 50000);
    `).simple();

    const { rows } = await service.getProcurementPlan(userId, projectId, { today: '2026-01-01' });
    expect(rows.some((r) => r.code === 'M.01')).toBe(false);
    expect(rows.some((r) => r.code === 'M.02')).toBe(true);
  });
});
