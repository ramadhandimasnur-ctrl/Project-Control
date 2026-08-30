import { randomUUID } from 'node:crypto';

import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { connectionOptions } from '@/db/connection';

import type * as CentralModule from '../central-warehouse';
import type { SessionUser } from '../session';

/**
 * A store shared between projects.
 *
 * Two things have to hold or the whole idea is worse than the three-guessed-
 * entries it replaces: the balance must never go negative, and material handed
 * to a project must arrive in that project's own stock at what was actually
 * paid for it — not at the newest invoice price.
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
      WHERE table_schema = 'public'
        AND table_name IN ('warehouse_receipts', 'warehouse_allocations')
    `;
    return rows[0]?.n === 2;
  } catch {
    return false;
  } finally {
    await probe.end();
  }
}

const ready = await schemaIsReady();
if (!ready) console.warn('[GUDANG PUSAT] Dilewati: database belum tersedia.');

describe.skipIf(!ready)('gudang pusat', () => {
  let sql: postgres.Sql;
  let service: typeof CentralModule;

  const orgId = randomUUID();
  const userId = randomUUID();
  const projectId = randomUUID();
  const unitId = randomUUID();
  const resourceId = randomUUID();
  const projectWarehouseId = randomUUID();

  const user: SessionUser = {
    id: userId,
    orgId,
    email: `pusat-${userId}@uji.test`,
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
        `DELETE FROM warehouses WHERE org_id = '${orgId}'`,
        `DELETE FROM resources WHERE org_id = '${orgId}'`,
        `DELETE FROM units WHERE org_id = '${orgId}'`,
        `DELETE FROM users WHERE org_id = '${orgId}'`,
        `DELETE FROM organizations WHERE id = '${orgId}'`,
        `INSERT INTO organizations (id, name) VALUES ('${orgId}', 'Org Pusat (uji)')`,
        `INSERT INTO users (id, org_id, email, full_name, global_role)
           VALUES ('${userId}', '${orgId}', '${user.email}', '${user.fullName}', 'ADMIN')`,
        `INSERT INTO units (id, org_id, code, name, dimension)
           VALUES ('${unitId}', '${orgId}', 'zak', 'zak', 'COUNT')`,
        `INSERT INTO resources (id, org_id, code, name, unit_id, type)
           VALUES ('${resourceId}', '${orgId}', 'M.01', 'Semen', '${unitId}', 'MATERIAL')`,
        `INSERT INTO projects (id, org_id, code, name, start_date, end_date)
           VALUES ('${projectId}', '${orgId}', 'PST-1', 'Proyek Penerima', '2026-01-01', '2026-12-31')`,
        `INSERT INTO project_members (project_id, user_id, role)
           VALUES ('${projectId}', '${userId}', 'PROJECT_MANAGER')`,
        `INSERT INTO warehouses (id, org_id, project_id, name, is_default)
           VALUES ('${projectWarehouseId}', '${orgId}', '${projectId}', 'Gudang Proyek', true)`,
        'COMMIT',
      ].join(';\n'),
    ).simple();
  };

  const central = () =>
    service.saveCentralWarehouse(user, null, {
      name: 'Gudang Pusat Purworejo',
      city: 'Purworejo',
      address: 'Jl. Mayjend Sutoyo',
    });

  const receive = (warehouseId: string, qty: string, unitPrice: string) =>
    service.recordReceipt(user, warehouseId, {
      supplierId: null,
      resourceId,
      docNo: null,
      receiptDate: '2026-01-05',
      qty,
      unitId,
      unitPrice,
      vatPercent: '0',
      dueDate: null,
      note: null,
    });

  beforeAll(async () => {
    sql = postgres(connectionOptions(url!, { max: 1, prepare: false, onnotice: () => {} }));
    service = await import('../central-warehouse');
  });

  beforeEach(buildFixture);

  afterAll(async () => {
    if (!sql) return;
    await sql.unsafe(`
      BEGIN;
      SELECT set_config('app.bypass_rls', 'on', true);
      SELECT set_config('app.allow_hard_delete', 'on', true);
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

  it('membuat gudang milik organisasi, bukan milik proyek', async () => {
    const { id } = await central();
    const list = await service.listCentralWarehouses(userId);

    expect(list.map((w) => w.id)).toContain(id);
    // The project's own warehouse must not appear in the central list.
    expect(list.map((w) => w.id)).not.toContain(projectWarehouseId);
  });

  it('menjumlahkan penerimaan menjadi stok', async () => {
    const { id } = await central();
    await receive(id, '100', '50000');
    await receive(id, '50', '60000');

    const { rows } = await service.getCentralStock(userId, id);
    const semen = rows.find((r) => r.code === 'M.01');

    expect(semen?.received).toBe('150.0000');
    expect(semen?.onHand).toBe('150.0000');
    // (100 x 50.000 + 50 x 60.000) / 150 = 53.333,33
    expect(semen?.avgUnitCost).toBe('53333.33');
  });

  /*
   * The weighted average, not the newest price. Valuing the remainder at the
   * most recent invoice would move the balance every time a supplier changed
   * their mind, without anything physical having happened.
   */
  it('mengalokasikan pada harga rata-rata tertimbang, bukan harga terakhir', async () => {
    const { id } = await central();
    await receive(id, '100', '50000');
    await receive(id, '100', '70000');

    const result = await service.allocateToProject(user, id, {
      projectId,
      resourceId,
      allocatedOn: '2026-01-10',
      qty: '40',
      note: null,
    });

    expect(result.unitCost).toBe('60000.00');
  });

  it('menuliskan mutasi masuk pada gudang proyek penerima', async () => {
    const { id } = await central();
    await receive(id, '100', '50000');
    await service.allocateToProject(user, id, {
      projectId,
      resourceId,
      allocatedOn: '2026-01-10',
      qty: '40',
      note: null,
    });

    const rows = await sql<{ qty: string; unit_cost: string; txn_type: string }[]>`
      SELECT qty::text, unit_cost::text, txn_type
      FROM material_transactions WHERE project_id = ${projectId}
    `;

    expect(rows).toHaveLength(1);
    expect(rows[0]?.txn_type).toBe('IN');
    expect(Number(rows[0]?.qty)).toBe(40);
    expect(Number(rows[0]?.unit_cost)).toBe(50000);
  });

  it('mengurangi stok pusat sebesar yang dialokasikan', async () => {
    const { id } = await central();
    await receive(id, '100', '50000');
    await service.allocateToProject(user, id, {
      projectId,
      resourceId,
      allocatedOn: '2026-01-10',
      qty: '40',
      note: null,
    });

    const { rows } = await service.getCentralStock(userId, id);
    const semen = rows.find((r) => r.code === 'M.01');

    expect(semen?.allocated).toBe('40.0000');
    expect(semen?.onHand).toBe('60.0000');
    expect(semen?.value).toBe('3000000.00');
  });

  /*
   * A store that can go negative is a store nobody trusts, and the shortfall
   * is always discovered by whoever turns up expecting material.
   */
  it('menolak alokasi melebihi stok yang ada', async () => {
    const { id } = await central();
    await receive(id, '100', '50000');

    await expect(
      service.allocateToProject(user, id, {
        projectId,
        resourceId,
        allocatedOn: '2026-01-10',
        qty: '150',
        note: null,
      }),
    ).rejects.toThrow(/Stok gudang hanya/);
  });

  it('menolak alokasi ke proyek yang belum punya gudang utama', async () => {
    const otherProjectId = randomUUID();
    await sql.unsafe(`
      INSERT INTO projects (id, org_id, code, name, start_date, end_date)
      VALUES ('${otherProjectId}', '${orgId}', 'PST-2', 'Tanpa Gudang', '2026-01-01', '2026-12-31');
      INSERT INTO project_members (project_id, user_id, role)
      VALUES ('${otherProjectId}', '${userId}', 'PROJECT_MANAGER');
    `).simple();

    const { id } = await central();
    await receive(id, '100', '50000');

    await expect(
      service.allocateToProject(user, id, {
        projectId: otherProjectId,
        resourceId,
        allocatedOn: '2026-01-10',
        qty: '10',
        note: null,
      }),
    ).rejects.toThrow(/gudang utama/);
  });

  // Quantity times price plus tax is arithmetic; a typed total is a fourth
  // number free to contradict the three it came from.
  it('menurunkan nilai penerimaan termasuk PPN', async () => {
    const { id } = await central();
    const result = await service.recordReceipt(user, id, {
      supplierId: null,
      resourceId,
      docNo: 'NOTA-1',
      receiptDate: '2026-01-05',
      qty: '100',
      unitId,
      unitPrice: '50000',
      vatPercent: '0.11',
      dueDate: '2026-02-05',
      note: null,
    });

    expect(result.totalAmount).toBe('5550000.00');
  });
});
