import { randomUUID } from 'node:crypto';

import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Integration checks for the guarantees that live in the database rather than
 * in TypeScript: the append-only triggers and row-level security.
 *
 * These cannot be asserted by a pure unit test, and they are exactly the rules
 * most likely to rot silently. The suite skips itself when no database is
 * reachable, so `npm test` still passes on a machine without Postgres — and
 * starts covering this ground the moment DATABASE_URL points somewhere real.
 */

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ path: '.env', quiet: true });

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

async function schemaIsReady(): Promise<boolean> {
  if (!url) return false;
  const probe = postgres(url, { max: 1, prepare: false, connect_timeout: 5, onnotice: () => {} });
  try {
    const rows = await probe`
      SELECT count(*)::int AS n
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('projects', 'material_transactions')
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
  console.warn(
    '[integritas] Dilewati: database belum tersedia atau migrasi belum dijalankan.\n' +
      '  Isi DATABASE_URL/DIRECT_URL di .env.local lalu jalankan: npm run db:setup',
  );
}

describe.skipIf(!ready)('integritas database', () => {
  let sql: postgres.Sql;

  // Two organisations that must never be able to see each other.
  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const projectA = randomUUID();
  const warehouseA = randomUUID();
  const unitId = randomUUID();
  const resourceId = randomUUID();
  const txnId = randomUUID();

  beforeAll(async () => {
    sql = postgres(url!, { max: 1, prepare: false, onnotice: () => {} });

    await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.bypass_rls', 'on', true)`;

      await tx`INSERT INTO organizations (id, name) VALUES (${orgA}, 'Org A (uji)'), (${orgB}, 'Org B (uji)')`;
      await tx`
        INSERT INTO users (id, org_id, email, full_name, global_role)
        VALUES (${userA}, ${orgA}, ${`a-${userA}@uji.test`}, 'Pengguna A', 'MEMBER'),
               (${userB}, ${orgB}, ${`b-${userB}@uji.test`}, 'Pengguna B', 'MEMBER')
      `;
      await tx`
        INSERT INTO projects (id, org_id, code, name, start_date, end_date)
        VALUES (${projectA}, ${orgA}, ${`UJI-${projectA.slice(0, 8)}`}, 'Proyek Uji A', '2026-01-01', '2026-12-31')
      `;
      await tx`INSERT INTO project_members (project_id, user_id, role) VALUES (${projectA}, ${userA}, 'PROJECT_MANAGER')`;
      await tx`INSERT INTO units (id, org_id, code, name, dimension) VALUES (${unitId}, ${orgA}, ${`kg-${unitId.slice(0, 6)}`}, 'Kilogram', 'MASS')`;
      await tx`
        INSERT INTO resources (id, org_id, code, name, unit_id, type)
        VALUES (${resourceId}, ${orgA}, ${`R-${resourceId.slice(0, 6)}`}, 'Besi uji', ${unitId}, 'MATERIAL')
      `;
      await tx`INSERT INTO warehouses (id, project_id, name) VALUES (${warehouseA}, ${projectA}, 'Gudang Uji')`;
      await tx`
        INSERT INTO material_transactions (id, project_id, warehouse_id, resource_id, txn_type, txn_date, qty, unit_id, unit_cost)
        VALUES (${txnId}, ${projectA}, ${warehouseA}, ${resourceId}, 'IN', '2026-03-01', 100, ${unitId}, 15500)
      `;
    });
  });

  afterAll(async () => {
    if (!sql) return;
    await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.bypass_rls', 'on', true)`;
      // Deleting a project cascades into the append-only ledgers.
      await tx`SELECT set_config('app.allow_hard_delete', 'on', true)`;
      await tx`DELETE FROM projects WHERE org_id IN (${orgA}, ${orgB})`;
      await tx`DELETE FROM resources WHERE org_id IN (${orgA}, ${orgB})`;
      await tx`DELETE FROM units WHERE org_id IN (${orgA}, ${orgB})`;
      await tx`DELETE FROM users WHERE org_id IN (${orgA}, ${orgB})`;
      await tx`DELETE FROM organizations WHERE id IN (${orgA}, ${orgB})`;
    });
    await sql.end();
  });

  describe('append-only ledger', () => {
    it('refuses to change the quantity of a material transaction', async () => {
      await expect(
        sql.begin(async (tx) => {
          await tx`SELECT set_config('app.bypass_rls', 'on', true)`;
          await tx`UPDATE material_transactions SET qty = 999 WHERE id = ${txnId}`;
        }),
      ).rejects.toThrow(/tidak dapat diubah/i);
    });

    it('refuses to change the unit cost, which the moving average replays over', async () => {
      await expect(
        sql.begin(async (tx) => {
          await tx`SELECT set_config('app.bypass_rls', 'on', true)`;
          await tx`UPDATE material_transactions SET unit_cost = 1 WHERE id = ${txnId}`;
        }),
      ).rejects.toThrow(/tidak dapat diubah/i);
    });

    it('refuses to delete a material transaction', async () => {
      await expect(
        sql.begin(async (tx) => {
          await tx`SELECT set_config('app.bypass_rls', 'on', true)`;
          await tx`DELETE FROM material_transactions WHERE id = ${txnId}`;
        }),
      ).rejects.toThrow(/tidak dapat dihapus/i);
    });

    // Regression: the delete trigger also fires on FK cascade, so without the
    // escape hatch a project could never be removed once it had one movement.
    it('still allows a project to be deleted, cascading through the ledger', async () => {
      const orgId = randomUUID();
      const projectId = randomUUID();
      const warehouseId = randomUUID();

      await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.bypass_rls', 'on', true)`;
        await tx`INSERT INTO organizations (id, name) VALUES (${orgId}, 'Org Hapus (uji)')`;
        await tx`
          INSERT INTO projects (id, org_id, code, name, start_date, end_date)
          VALUES (${projectId}, ${orgId}, ${`DEL-${projectId.slice(0, 8)}`}, 'Proyek Hapus', '2026-01-01', '2026-12-31')
        `;
        await tx`INSERT INTO warehouses (id, project_id, name) VALUES (${warehouseId}, ${projectId}, 'Gudang')`;
        await tx`
          INSERT INTO material_transactions (project_id, warehouse_id, resource_id, txn_type, txn_date, qty, unit_id)
          VALUES (${projectId}, ${warehouseId}, ${resourceId}, 'IN', '2026-03-01', 5, ${unitId})
        `;
      });

      await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.bypass_rls', 'on', true)`;
        await tx`SELECT set_config('app.allow_hard_delete', 'on', true)`;
        await tx`DELETE FROM projects WHERE id = ${projectId}`;
        await tx`DELETE FROM organizations WHERE id = ${orgId}`;
      });

      const rows = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.bypass_rls', 'on', true)`;
        return tx`SELECT id FROM material_transactions WHERE project_id = ${projectId}`;
      });
      expect(rows).toHaveLength(0);
    });

    it('allows a void, which is the sanctioned correction', async () => {
      await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.bypass_rls', 'on', true)`;
        await tx`UPDATE material_transactions SET is_void = true, void_reason = 'salah input' WHERE id = ${txnId}`;
      });

      const rows = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.bypass_rls', 'on', true)`;
        return tx`SELECT is_void FROM material_transactions WHERE id = ${txnId}`;
      });
      expect(rows[0]?.is_void).toBe(true);
    });
  });

  describe('check constraints', () => {
    it('rejects an OUT movement with no work item to charge it to', async () => {
      await expect(
        sql.begin(async (tx) => {
          await tx`SELECT set_config('app.bypass_rls', 'on', true)`;
          await tx`
            INSERT INTO material_transactions (project_id, warehouse_id, resource_id, txn_type, txn_date, qty, unit_id)
            VALUES (${projectA}, ${warehouseA}, ${resourceId}, 'OUT', '2026-03-02', 10, ${unitId})
          `;
        }),
      ).rejects.toThrow(/material_transactions_out_needs_work_item/);
    });

    it('rejects a cash category that contradicts its direction', async () => {
      const accountId = randomUUID();
      await expect(
        sql.begin(async (tx) => {
          await tx`SELECT set_config('app.bypass_rls', 'on', true)`;
          await tx`INSERT INTO cash_accounts (id, project_id, name, type) VALUES (${accountId}, ${projectA}, 'Kas Uji', 'CASH')`;
          // MATERIAL is an outflow category; pairing it with IN must fail.
          await tx`
            INSERT INTO cash_transactions (project_id, account_id, txn_date, direction, category, amount)
            VALUES (${projectA}, ${accountId}, '2026-03-02', 'IN', 'MATERIAL', 1000)
          `;
        }),
      ).rejects.toThrow(/cash_transactions_category_matches_direction/);
    });
  });

  describe('row level security', () => {
    it('shows a member their own project', async () => {
      const rows = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_user_id', ${userA}, true)`;
        return tx`SELECT id FROM projects WHERE id = ${projectA}`;
      });
      expect(rows).toHaveLength(1);
    });

    // The backstop that matters: even a query with no service-layer guard must
    // not cross an organisation boundary.
    it('hides the project from a user in another organisation', async () => {
      const rows = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_user_id', ${userB}, true)`;
        return tx`SELECT id FROM projects WHERE id = ${projectA}`;
      });
      expect(rows).toHaveLength(0);
    });

    it('hides project-scoped data from an outsider', async () => {
      const rows = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_user_id', ${userB}, true)`;
        return tx`SELECT id FROM material_transactions WHERE project_id = ${projectA}`;
      });
      expect(rows).toHaveLength(0);
    });

    it('fails closed when no user context is set', async () => {
      const rows = await sql.begin(async (tx) => {
        return tx`SELECT id FROM material_transactions WHERE project_id = ${projectA}`;
      });
      expect(rows).toHaveLength(0);
    });
  });
});
