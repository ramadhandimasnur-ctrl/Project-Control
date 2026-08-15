import { randomUUID } from 'node:crypto';

import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { connectionOptions } from '@/db/connection';
import type * as MaterialTxnModule from '../material-transactions';
import type * as PurchasesModule from '../purchases';
import type { SessionUser } from '../session';

/**
 * Phase 4's definition of done: the buy → stock → cash chain, and proof that a
 * failure part way through leaves nothing behind.
 *
 * Posting is the one operation that writes to three places at once. If it
 * could half-succeed, stock would exist with no cash trail — a discrepancy
 * nobody would notice until a reconciliation months later.
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
      WHERE table_schema = 'public' AND table_name IN ('purchases', 'material_transactions')
    `;
    return rows[0]?.n === 2;
  } catch {
    return false;
  } finally {
    await probe.end();
  }
}

const ready = await schemaIsReady();
if (!ready) console.warn('[POST pembelian] Dilewati: database belum tersedia.');

describe.skipIf(!ready)('POST pembelian', () => {
  let sql: postgres.Sql;
  let purchasesSvc: typeof PurchasesModule;
  let movements: typeof MaterialTxnModule;

  const orgId = randomUUID();
  const userId = randomUUID();
  const projectId = randomUUID();
  const warehouseId = randomUUID();
  const cashAccountId = randomUUID();
  const kgUnitId = randomUUID();
  const tonUnitId = randomUUID();
  const resourceId = randomUUID();
  const workItemId = randomUUID();

  const user: SessionUser = {
    id: userId,
    orgId,
    email: `post-${userId}@uji.test`,
    fullName: 'Logistik Uji',
    globalRole: 'ADMIN',
  };

  const stockOf = async () => {
    const [row] = await sql`
      SELECT
        coalesce(sum(CASE WHEN txn_type = 'IN' THEN qty ELSE -qty END), 0) AS qty,
        count(*)::int AS movements
      FROM material_transactions
      WHERE project_id = ${projectId} AND is_void = false
    `;
    return { qty: Number(row?.qty ?? 0), movements: Number(row?.movements ?? 0) };
  };

  const cashOf = async () => {
    const [row] = await sql`
      SELECT coalesce(sum(amount), 0) AS total, count(*)::int AS rows
      FROM cash_transactions
      WHERE project_id = ${projectId} AND is_void = false
    `;
    return { total: Number(row?.total ?? 0), rows: Number(row?.rows ?? 0) };
  };

  const buildFixture = async (costRecognition = 'PURCHASE_BASED'): Promise<void> => {
    await sql.unsafe(`
      BEGIN;
      SELECT set_config('app.bypass_rls', 'on', true);
      SELECT set_config('app.allow_hard_delete', 'on', true);
      DELETE FROM projects WHERE org_id = '${orgId}';
      DELETE FROM resources WHERE org_id = '${orgId}';
      DELETE FROM units WHERE org_id = '${orgId}';
      DELETE FROM users WHERE org_id = '${orgId}';
      DELETE FROM organizations WHERE id = '${orgId}';

      INSERT INTO organizations (id, name) VALUES ('${orgId}', 'Org POST (uji)');
      INSERT INTO users (id, org_id, email, full_name, global_role)
        VALUES ('${userId}', '${orgId}', '${user.email}', '${user.fullName}', 'ADMIN');
      INSERT INTO projects (id, org_id, code, name, start_date, end_date, cost_recognition)
        VALUES ('${projectId}', '${orgId}', 'POST-1', 'Proyek POST',
                '2026-01-01', '2026-12-31', '${costRecognition}');
      INSERT INTO project_members (project_id, user_id, role)
        VALUES ('${projectId}', '${userId}', 'PROJECT_MANAGER');

      INSERT INTO units (id, org_id, code, name, dimension, factor_to_base)
        VALUES ('${kgUnitId}', '${orgId}', 'kg', 'Kilogram', 'MASS', 1),
               ('${tonUnitId}', '${orgId}', 'ton', 'Ton', 'MASS', 1000);
      INSERT INTO resources (id, org_id, code, name, unit_id, type)
        VALUES ('${resourceId}', '${orgId}', 'M.04', 'besi beton', '${kgUnitId}', 'MATERIAL');

      INSERT INTO warehouses (id, project_id, name, is_default)
        VALUES ('${warehouseId}', '${projectId}', 'Gudang Utama', true);
      INSERT INTO cash_accounts (id, project_id, name, type, opening_balance)
        VALUES ('${cashAccountId}', '${projectId}', 'Kas Proyek', 'CASH', 0);

      INSERT INTO work_items (id, project_id, code, name, unit_id, volume)
        VALUES ('${workItemId}', '${projectId}', 'A.01', 'Pembesian', '${kgUnitId}', 1000);
      COMMIT;
    `).simple();
  };

  /**
   * Arms a trigger that makes any cash insert fail, so the rollback can be
   * observed.
   *
   * Scoped to this test's project with a WHEN clause. It used to fire for every
   * row in the table, and since vitest runs test files in parallel against one
   * database, it broke an unrelated suite's payment posting — a failure that
   * looked like a bug in the code under test and was not.
   */
  const breakCashInserts = async (message: string): Promise<void> => {
    await sql.unsafe(`
      CREATE OR REPLACE FUNCTION pc_test_break_cash() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION '${message}';
      END;
      $$;
      DROP TRIGGER IF EXISTS trg_pc_test_break_cash ON public.cash_transactions;
      CREATE TRIGGER trg_pc_test_break_cash
        BEFORE INSERT ON public.cash_transactions
        FOR EACH ROW WHEN (NEW.project_id = '${projectId}')
        EXECUTE FUNCTION pc_test_break_cash();
    `).simple();
  };

  const repairCashInserts = async (): Promise<void> => {
    await sql.unsafe(`
      DROP TRIGGER IF EXISTS trg_pc_test_break_cash ON public.cash_transactions;
      DROP FUNCTION IF EXISTS pc_test_break_cash();
    `).simple();
  };

  const draft = async (qty = '100', unitPrice = '15500', unitId = kgUnitId) =>
    purchasesSvc.saveDraftPurchase(
      user,
      projectId,
      null,
      { purchaseDate: '2026-03-01', invoiceNo: 'INV-001', vatAmount: '0' },
      [{ resourceId, warehouseId, qty, unitId, unitPrice }],
    );

  beforeAll(async () => {
    sql = postgres(connectionOptions(url!, { max: 1, prepare: false, onnotice: () => {} }));
    [purchasesSvc, movements] = await Promise.all([
      import('../purchases'),
      import('../material-transactions'),
    ]);
  });

  beforeEach(() => buildFixture());

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

  describe('alur beli → stok → kas', () => {
    it('menulis mutasi stok dan kas keluar sekaligus', async () => {
      const purchase = await draft();
      const result = await purchasesSvc.postPurchase(user, projectId, purchase.id);

      expect(result.movementsCreated).toBe(1);
      expect(result.cashRecorded).toBe(true);

      expect(await stockOf()).toEqual({ qty: 100, movements: 1 });
      // 100 x 15.500
      expect(await cashOf()).toEqual({ total: 1550000, rows: 1 });
    });

    it('menghitung ulang rata-rata bergerak dari mutasi', async () => {
      const first = await draft('100', '15500');
      await purchasesSvc.postPurchase(user, projectId, first.id);

      const second = await draft('100', '16200');
      await purchasesSvc.postPurchase(user, projectId, second.id);

      const position = await movements.getStockPosition(userId, projectId, resourceId, warehouseId);
      expect(position.qty).toBe('200.0000');
      expect(position.averageCost).toBe('15850.00');
    });

    // Buying by the tonne while the catalogue counts kilograms is ordinary;
    // stock has to be addable afterwards.
    it('mengonversi satuan pembelian ke satuan sumber daya', async () => {
      const purchase = await draft('2', '15500000', tonUnitId);
      await purchasesSvc.postPurchase(user, projectId, purchase.id);

      const position = await movements.getStockPosition(userId, projectId, resourceId, warehouseId);
      expect(position.qty).toBe('2000.0000');
      // Rp31.000.000 spread over 2.000 kg.
      expect(position.averageCost).toBe('15500.00');
    });

    it('menolak POST dua kali', async () => {
      const purchase = await draft();
      await purchasesSvc.postPurchase(user, projectId, purchase.id);

      await expect(purchasesSvc.postPurchase(user, projectId, purchase.id)).rejects.toThrow(
        /sudah di-POST/i,
      );
      expect((await stockOf()).movements).toBe(1);
    });

    it('tidak mencatat kas bila biaya diakui saat pemakaian', async () => {
      await buildFixture('CONSUMPTION_BASED');
      const purchase = await draft();
      const result = await purchasesSvc.postPurchase(user, projectId, purchase.id);

      expect(result.cashRecorded).toBe(false);
      expect((await stockOf()).qty).toBe(100);
      expect((await cashOf()).rows).toBe(0);
    });
  });

  describe('rollback', () => {
    /*
     * The failure is forced at the last step: a cash category that contradicts
     * its direction trips a CHECK constraint the database holds. By then the
     * purchase has been marked POSTED and the stock movement written, so if
     * the transaction were not atomic those two would survive.
     */
    it('tidak meninggalkan baris apa pun ketika langkah terakhir gagal', async () => {
      const purchase = await draft();

      await breakCashInserts('kegagalan buatan saat mencatat kas');

      try {
        let thrown: unknown;
        try {
          await purchasesSvc.postPurchase(user, projectId, purchase.id);
        } catch (error) {
          thrown = error;
        }

        expect(thrown).toBeInstanceOf(Error);
        // Drizzle rethrows as "Failed query: …" and keeps the driver error in
        // `cause`, so the original message is looked for across the chain.
        const chain: string[] = [];
        for (let e = thrown; e instanceof Error; e = e.cause) chain.push(e.message);
        expect(chain.join(' | ')).toMatch(/kegagalan buatan/i);

        // Nothing survives: no stock, no cash, and the purchase is still DRAFT.
        expect(await stockOf()).toEqual({ qty: 0, movements: 0 });
        expect(await cashOf()).toEqual({ total: 0, rows: 0 });

        const [row] = await sql`SELECT status FROM purchases WHERE id = ${purchase.id}`;
        expect(row?.status).toBe('DRAFT');
      } finally {
        await repairCashInserts();
      }
    });

    it('dapat di-POST dengan benar setelah kegagalan diperbaiki', async () => {
      const purchase = await draft();

      await breakCashInserts('gagal');
      try {
        await expect(purchasesSvc.postPurchase(user, projectId, purchase.id)).rejects.toThrow();
      } finally {
        // In a finally: an assertion that throws here used to leave the
        // trigger armed for whatever ran next.
        await repairCashInserts();
      }

      const result = await purchasesSvc.postPurchase(user, projectId, purchase.id);
      expect(result.movementsCreated).toBe(1);
      expect(await stockOf()).toEqual({ qty: 100, movements: 1 });
      expect((await cashOf()).rows).toBe(1);
    });

    // Without a cash account there is nowhere to record the payment, so the
    // whole posting is refused rather than silently skipping the cash leg.
    it('menolak POST bila proyek belum punya akun kas', async () => {
      await sql.unsafe(`DELETE FROM cash_accounts WHERE project_id = '${projectId}'`);
      const purchase = await draft();

      await expect(purchasesSvc.postPurchase(user, projectId, purchase.id)).rejects.toThrow(
        /belum memiliki akun kas/i,
      );
      expect(await stockOf()).toEqual({ qty: 0, movements: 0 });
    });
  });

  describe('pembatalan', () => {
    it('membatalkan mutasi dan kas, bukan menghapusnya', async () => {
      const purchase = await draft();
      await purchasesSvc.postPurchase(user, projectId, purchase.id);

      await purchasesSvc.voidPurchase(user, projectId, purchase.id, 'salah supplier');

      // Rows remain, marked, so the ledger still shows what happened.
      const [movementRow] = await sql`
        SELECT is_void, void_reason FROM material_transactions WHERE project_id = ${projectId}
      `;
      expect(movementRow?.is_void).toBe(true);
      expect(movementRow?.void_reason).toBe('salah supplier');

      const [cashRow] = await sql`
        SELECT is_void FROM cash_transactions WHERE project_id = ${projectId}
      `;
      expect(cashRow?.is_void).toBe(true);

      // And they no longer count towards stock.
      const position = await movements.getStockPosition(userId, projectId, resourceId, warehouseId);
      expect(position.qty).toBe('0.0000');
    });

    it('menolak pembatalan tanpa alasan', async () => {
      const purchase = await draft();
      await purchasesSvc.postPurchase(user, projectId, purchase.id);

      await expect(purchasesSvc.voidPurchase(user, projectId, purchase.id, '  ')).rejects.toThrow(
        /alasan pembatalan wajib/i,
      );
    });
  });

  describe('mutasi manual', () => {
    it('mengeluarkan barang dan mengurangi stok', async () => {
      const purchase = await draft();
      await purchasesSvc.postPurchase(user, projectId, purchase.id);

      await movements.recordMovement(user, projectId, {
        txnType: 'OUT',
        txnDate: '2026-03-05',
        resourceId,
        warehouseId,
        qty: '40',
        unitId: kgUnitId,
        workItemId,
      });

      const position = await movements.getStockPosition(userId, projectId, resourceId, warehouseId);
      expect(position.qty).toBe('60.0000');
      // Issuing does not move the average.
      expect(position.averageCost).toBe('15500.00');
    });

    it('menolak pengeluaran yang tidak menyebut pekerjaan', async () => {
      await expect(
        movements.recordMovement(user, projectId, {
          txnType: 'OUT',
          txnDate: '2026-03-05',
          resourceId,
          warehouseId,
          qty: '10',
          unitId: kgUnitId,
        }),
      ).rejects.toThrow(/menyebutkan pekerjaan/i);
    });

    it('menolak pengeluaran melebihi stok', async () => {
      const purchase = await draft('50', '15500');
      await purchasesSvc.postPurchase(user, projectId, purchase.id);

      await expect(
        movements.recordMovement(user, projectId, {
          txnType: 'OUT',
          txnDate: '2026-03-05',
          resourceId,
          warehouseId,
          qty: '80',
          unitId: kgUnitId,
          workItemId,
        }),
      ).rejects.toThrow(/tidak mencukupi/i);
    });

    // The stock count that finds less than the books claim — the reason the
    // CHECK was relaxed in migration 0001.
    it('mencatat penyesuaian stok bernilai negatif', async () => {
      const purchase = await draft('100', '15500');
      await purchasesSvc.postPurchase(user, projectId, purchase.id);

      await movements.recordMovement(user, projectId, {
        txnType: 'ADJUSTMENT',
        txnDate: '2026-03-10',
        resourceId,
        warehouseId,
        qty: '-3',
        unitId: kgUnitId,
        note: 'selisih stock opname',
      });

      const position = await movements.getStockPosition(userId, projectId, resourceId, warehouseId);
      expect(position.qty).toBe('97.0000');
    });

    it('menolak penerimaan manual, karena itu milik POST pembelian', async () => {
      await expect(
        movements.recordMovement(user, projectId, {
          txnType: 'IN',
          txnDate: '2026-03-05',
          resourceId,
          warehouseId,
          qty: '10',
          unitId: kgUnitId,
        }),
      ).rejects.toThrow(/POST pembelian/i);
    });

    it('menolak pembatalan mutasi yang berasal dari pembelian', async () => {
      const purchase = await draft();
      await purchasesSvc.postPurchase(user, projectId, purchase.id);

      const [row] = await sql`
        SELECT id FROM material_transactions WHERE project_id = ${projectId}
      `;

      await expect(
        movements.voidMovement(user, projectId, String(row?.id), 'coba'),
      ).rejects.toThrow(/berasal dari pembelian/i);
    });
  });

  /**
   * views.sql promises each view ships with a test asserting it agrees with
   * the pure function it mirrors. The moving-average view is recursive, so
   * this is where that promise is worth the most.
   */
  describe('view SQL sepakat dengan lib/calc', () => {
    const round = (v: unknown, dp: number) => Number(v).toFixed(dp);

    it('v_inventory_moving_cost cocok dengan getStockPosition', async () => {
      await purchasesSvc.postPurchase(user, projectId, (await draft('100', '15500')).id);
      await purchasesSvc.postPurchase(user, projectId, (await draft('100', '16200')).id);

      const position = await movements.getStockPosition(userId, projectId, resourceId, warehouseId);
      const [row] = await sql`
        SELECT qty_on_hand, moving_average_cost, stock_value
        FROM v_inventory_moving_cost
        WHERE project_id = ${projectId} AND resource_id = ${resourceId}
      `;

      expect(round(row?.qty_on_hand, 4)).toBe(position.qty);
      expect(round(row?.moving_average_cost, 2)).toBe(position.averageCost);
      expect(round(row?.stock_value, 2)).toBe(position.value);
    });

    /*
     * The case a plain aggregate gets wrong. An issue between the two receipts
     * lowers the balance the second receipt averages against, so the answer is
     * 15.966,67 rather than the 15.850 that Σ(qty×price)/Σqty would give.
     */
    it('memperhitungkan pengeluaran di antara dua penerimaan', async () => {
      await purchasesSvc.postPurchase(user, projectId, (await draft('100', '15500')).id);

      await movements.recordMovement(user, projectId, {
        txnType: 'OUT',
        txnDate: '2026-03-02',
        resourceId,
        warehouseId,
        qty: '50',
        unitId: kgUnitId,
        workItemId,
      });

      await purchasesSvc.saveDraftPurchase(
        user,
        projectId,
        null,
        { purchaseDate: '2026-03-03', invoiceNo: 'INV-002', vatAmount: '0' },
        [{ resourceId, warehouseId, qty: '100', unitId: kgUnitId, unitPrice: '16200' }],
      ).then((p) => purchasesSvc.postPurchase(user, projectId, p.id));

      const position = await movements.getStockPosition(userId, projectId, resourceId, warehouseId);
      const [row] = await sql`
        SELECT qty_on_hand, moving_average_cost FROM v_inventory_moving_cost
        WHERE project_id = ${projectId} AND resource_id = ${resourceId}
      `;

      expect(position.averageCost).toBe('15966.67');
      expect(round(row?.moving_average_cost, 2)).toBe('15966.67');
      expect(round(row?.qty_on_hand, 4)).toBe('150.0000');
    });

    it('v_inventory_balance memisahkan masuk, keluar, dan penyesuaian', async () => {
      await purchasesSvc.postPurchase(user, projectId, (await draft('100', '15500')).id);
      await movements.recordMovement(user, projectId, {
        txnType: 'OUT', txnDate: '2026-03-05', resourceId, warehouseId,
        qty: '30', unitId: kgUnitId, workItemId,
      });
      await movements.recordMovement(user, projectId, {
        txnType: 'ADJUSTMENT', txnDate: '2026-03-06', resourceId, warehouseId,
        qty: '-2', unitId: kgUnitId,
      });

      const [row] = await sql`
        SELECT qty_received, qty_issued, qty_adjusted, qty_on_hand, resource_code
        FROM v_inventory_balance
        WHERE project_id = ${projectId} AND resource_id = ${resourceId}
      `;

      expect(row?.resource_code).toBe('M.04');
      expect(round(row?.qty_received, 0)).toBe('100');
      expect(round(row?.qty_issued, 0)).toBe('30');
      expect(round(row?.qty_adjusted, 0)).toBe('-2');
      expect(round(row?.qty_on_hand, 0)).toBe('68');
    });

    it('mengeluarkan mutasi yang dibatalkan dari saldo', async () => {
      const purchase = await draft('100', '15500');
      await purchasesSvc.postPurchase(user, projectId, purchase.id);
      await purchasesSvc.voidPurchase(user, projectId, purchase.id, 'retur');

      const rows = await sql`
        SELECT qty_on_hand FROM v_inventory_moving_cost
        WHERE project_id = ${projectId} AND resource_id = ${resourceId}
      `;
      expect(rows).toHaveLength(0);
    });

    it('v_resource_actual_price menghitung varians terhadap RAP', async () => {
      await sql.unsafe(`
        INSERT INTO resource_prices (resource_id, project_id, price_type, price, effective_from)
        VALUES ('${resourceId}', NULL, 'RAP', 15500, '2026-01-01')
      `);

      await purchasesSvc.postPurchase(user, projectId, (await draft('100', '15500')).id);
      await purchasesSvc.postPurchase(user, projectId, (await draft('100', '16200')).id);

      const [row] = await sql`
        SELECT average_price, min_price, max_price, last_price,
               variance_per_unit, variance_percent, variance_value, purchase_count
        FROM v_resource_actual_price
        WHERE project_id = ${projectId} AND resource_id = ${resourceId}
      `;

      // The charter's example: average 15.850 against RAP 15.500 is +350 (+2,26%).
      expect(round(row?.average_price, 2)).toBe('15850.00');
      expect(round(row?.variance_per_unit, 2)).toBe('350.00');
      expect(round(Number(row?.variance_percent) * 100, 2)).toBe('2.26');
      expect(round(row?.variance_value, 2)).toBe('70000.00');
      expect(round(row?.min_price, 0)).toBe('15500');
      expect(round(row?.max_price, 0)).toBe('16200');
      expect(Number(row?.purchase_count)).toBe(2);
    });

    // A draft is an intention, not a price.
    it('mengabaikan pembelian yang belum di-POST', async () => {
      await draft('100', '99999');

      const rows = await sql`
        SELECT * FROM v_resource_actual_price
        WHERE project_id = ${projectId} AND resource_id = ${resourceId}
      `;
      expect(rows).toHaveLength(0);
    });
  });
});
