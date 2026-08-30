import { and, eq, isNull, sql } from 'drizzle-orm';

import { withUser } from '@/db/context';
import {
  materialTransactions,
  warehouseAllocations,
  warehouseReceipts,
  warehouses,
} from '@/db/schema';
import { toDecimal, ZERO } from '@/lib/calc/decimal';
import { conflict, notFound } from '@/lib/errors';

import { assertOrgAccess } from './org-access';
import { writeAuditLog } from './audit';
import { type SessionUser } from './session';

/**
 * Stores that belong to the organisation rather than to one project.
 *
 * Buying in bulk for several sites is ordinary, and a warehouse that had to
 * belong to exactly one project made a lorry-load of cement split three ways
 * into three entries at three guessed quantities. Here it arrives once and is
 * handed out as each site needs it.
 *
 * Issuing writes an ordinary IN movement on the receiving project's own
 * warehouse. That is deliberate: material planning, stock and costing already
 * read project movements, and teaching all of them about a second kind of
 * stock would have been a much larger change than adding one.
 */

export type CentralWarehouseRow = {
  id: string;
  name: string;
  city: string | null;
  address: string | null;
  /** Received less allocated, per resource, summed. */
  resourceCount: number;
  stockValue: string;
};

export async function listCentralWarehouses(userId: string): Promise<CentralWarehouseRow[]> {
  const access = await assertOrgAccess(userId);

  const rows = await withUser(userId, (tx) =>
    tx.execute<{
      id: string;
      name: string;
      city: string | null;
      address: string | null;
      resource_count: number;
      stock_value: string;
    }>(sql`
      WITH balance AS (
        SELECT w.id AS warehouse_id, r.resource_id,
               sum(r.qty) - coalesce(a.allocated, 0) AS qty,
               max(r.unit_price) AS unit_price
        FROM warehouses w
        JOIN warehouse_receipts r ON r.warehouse_id = w.id
        LEFT JOIN LATERAL (
          SELECT sum(al.qty) AS allocated FROM warehouse_allocations al
          WHERE al.warehouse_id = w.id AND al.resource_id = r.resource_id
        ) a ON true
        WHERE w.org_id = ${access.orgId} AND w.project_id IS NULL
        GROUP BY w.id, r.resource_id, a.allocated
      )
      SELECT
        w.id, w.name, w.city, w.address,
        coalesce((SELECT count(*)::int FROM balance b
                  WHERE b.warehouse_id = w.id AND b.qty > 0), 0) AS resource_count,
        coalesce((SELECT sum(b.qty * b.unit_price) FROM balance b
                  WHERE b.warehouse_id = w.id AND b.qty > 0), 0)::text AS stock_value
      FROM warehouses w
      WHERE w.org_id = ${access.orgId} AND w.project_id IS NULL
      ORDER BY w.name
    `),
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    city: row.city,
    address: row.address,
    resourceCount: row.resource_count,
    stockValue: toDecimal(row.stock_value).toFixed(2),
  }));
}

export type CentralStockRow = {
  resourceId: string;
  code: string;
  name: string;
  unitCode: string;
  received: string;
  allocated: string;
  onHand: string;
  /** Weighted by what was paid, not by the latest price. */
  avgUnitCost: string;
  value: string;
};

export async function getCentralStock(
  userId: string,
  warehouseId: string,
): Promise<{ warehouse: CentralWarehouseRow; rows: CentralStockRow[] }> {
  const access = await assertOrgAccess(userId);

  const [warehouse] = await withUser(userId, (tx) =>
    tx
      .select()
      .from(warehouses)
      .where(
        and(
          eq(warehouses.id, warehouseId),
          eq(warehouses.orgId, access.orgId),
          isNull(warehouses.projectId),
        ),
      )
      .limit(1),
  );

  if (!warehouse) throw notFound('Gudang pusat tidak ditemukan.');

  const rows = await withUser(userId, (tx) =>
    tx.execute<{
      resource_id: string;
      code: string;
      name: string;
      unit_code: string;
      received: string;
      received_value: string;
      allocated: string;
    }>(sql`
      SELECT
        r.id AS resource_id, r.code, r.name, u.code AS unit_code,
        coalesce(rc.qty, 0)::text        AS received,
        coalesce(rc.value, 0)::text      AS received_value,
        coalesce(al.qty, 0)::text        AS allocated
      FROM resources r
      JOIN units u ON u.id = r.unit_id
      LEFT JOIN LATERAL (
        SELECT sum(qty) AS qty, sum(qty * unit_price) AS value
        FROM warehouse_receipts WHERE warehouse_id = ${warehouseId} AND resource_id = r.id
      ) rc ON true
      LEFT JOIN LATERAL (
        SELECT sum(qty) AS qty
        FROM warehouse_allocations WHERE warehouse_id = ${warehouseId} AND resource_id = r.id
      ) al ON true
      WHERE coalesce(rc.qty, 0) <> 0 OR coalesce(al.qty, 0) <> 0
      ORDER BY r.code
    `),
  );

  return {
    warehouse: {
      id: warehouse.id,
      name: warehouse.name,
      city: warehouse.city,
      address: warehouse.address,
      resourceCount: rows.length,
      stockValue: '0.00',
    },
    rows: rows.map((row): CentralStockRow => {
      const received = toDecimal(row.received);
      const allocated = toDecimal(row.allocated);
      const onHand = received.minus(allocated);
      /*
       * Weighted average, not the latest price. Three deliveries at different
       * prices leave stock worth what was actually paid for it; valuing the
       * remainder at the most recent invoice would move the balance sheet every
       * time a supplier changed their mind.
       */
      const avg = received.isZero() ? ZERO : toDecimal(row.received_value).dividedBy(received);

      return {
        resourceId: row.resource_id,
        code: row.code,
        name: row.name,
        unitCode: row.unit_code,
        received: received.toFixed(4),
        allocated: allocated.toFixed(4),
        onHand: onHand.toFixed(4),
        avgUnitCost: avg.toFixed(2),
        value: onHand.times(avg).toFixed(2),
      };
    }),
  };
}

export async function saveCentralWarehouse(
  user: SessionUser,
  warehouseId: string | null,
  input: { name: string; city: string | null; address: string | null },
): Promise<{ id: string }> {
  const access = await assertOrgAccess(user.id, 'ADMIN');

  return withUser(user.id, async (tx) => {
    let id = warehouseId;

    if (id === null) {
      const [created] = await tx
        .insert(warehouses)
        .values({
          orgId: access.orgId,
          projectId: null,
          name: input.name,
          city: input.city,
          address: input.address,
          createdBy: user.id,
          updatedBy: user.id,
        })
        .returning({ id: warehouses.id });
      if (!created) throw conflict('Gudang pusat gagal dibuat.');
      id = created.id;
    } else {
      await tx
        .update(warehouses)
        .set({ name: input.name, city: input.city, address: input.address, updatedBy: user.id })
        .where(and(eq(warehouses.id, id), eq(warehouses.orgId, access.orgId)));
    }

    await writeAuditLog(tx, {
      orgId: access.orgId,
      tableName: 'warehouses',
      recordId: id,
      action: warehouseId === null ? 'INSERT' : 'UPDATE',
      before: null,
      after: { name: input.name, central: true },
      actorId: user.id,
    });

    return { id };
  });
}

export type ReceiptInput = {
  supplierId: string | null;
  resourceId: string;
  docNo: string | null;
  receiptDate: string;
  qty: string;
  unitId: string | null;
  unitPrice: string;
  vatPercent: string;
  dueDate: string | null;
  note: string | null;
};

export async function recordReceipt(
  user: SessionUser,
  warehouseId: string,
  input: ReceiptInput,
): Promise<{ id: string; totalAmount: string }> {
  const access = await assertOrgAccess(user.id, 'ADMIN');

  // Derived, never typed: quantity times price plus tax is arithmetic, and a
  // typed total is a fourth number free to contradict the three it came from.
  const net = toDecimal(input.qty).times(toDecimal(input.unitPrice));
  const total = net.times(toDecimal(1).plus(toDecimal(input.vatPercent)));

  return withUser(user.id, async (tx) => {
    const [created] = await tx
      .insert(warehouseReceipts)
      .values({
        warehouseId,
        supplierId: input.supplierId,
        resourceId: input.resourceId,
        docNo: input.docNo,
        receiptDate: input.receiptDate,
        qty: input.qty,
        unitId: input.unitId,
        unitPrice: input.unitPrice,
        vatPercent: input.vatPercent,
        totalAmount: total.toFixed(2),
        dueDate: input.dueDate,
        note: input.note,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning({ id: warehouseReceipts.id });

    if (!created) throw conflict('Penerimaan gudang gagal dicatat.');

    await writeAuditLog(tx, {
      orgId: access.orgId,
      tableName: 'warehouse_receipts',
      recordId: created.id,
      action: 'INSERT',
      before: null,
      after: { qty: input.qty, totalAmount: total.toFixed(2) },
      actorId: user.id,
    });

    return { id: created.id, totalAmount: total.toFixed(2) };
  });
}

/**
 * Hands central stock to a project.
 *
 * Refuses to allocate more than is on hand — a store that can go negative is a
 * store nobody trusts, and the shortfall is always discovered by whoever turns
 * up expecting material.
 *
 * The receiving project gets an ordinary IN movement on its default warehouse,
 * priced at the central store's weighted average. From that point the material
 * behaves like anything else the project bought.
 */
export async function allocateToProject(
  user: SessionUser,
  warehouseId: string,
  input: { projectId: string; resourceId: string; allocatedOn: string; qty: string; note: string | null },
): Promise<{ id: string; unitCost: string }> {
  const access = await assertOrgAccess(user.id, 'ADMIN');

  const stock = await getCentralStock(user.id, warehouseId);
  const line = stock.rows.find((row) => row.resourceId === input.resourceId);
  const onHand = toDecimal(line?.onHand ?? '0');
  const qty = toDecimal(input.qty);

  if (qty.greaterThan(onHand)) {
    throw conflict(
      `Stok gudang hanya ${onHand.toString()} ${line?.unitCode ?? ''}.`,
      'Catat penerimaan lebih dulu, atau kurangi jumlah yang dialokasikan.',
    );
  }

  const unitCost = line?.avgUnitCost ?? '0.00';

  return withUser(user.id, async (tx) => {
    const [target] = await tx
      .select({ id: warehouses.id, unitId: sql<string | null>`NULL` })
      .from(warehouses)
      .where(and(eq(warehouses.projectId, input.projectId), eq(warehouses.isDefault, true)))
      .limit(1);

    if (!target) {
      throw conflict(
        'Proyek tujuan belum punya gudang utama.',
        'Buat gudang pada proyek itu lebih dulu, supaya material yang dikirim punya tempat mendarat.',
      );
    }

    const [resourceRow] = await tx.execute<{ unit_id: string }>(sql`
      SELECT unit_id FROM resources WHERE id = ${input.resourceId}
    `);

    const [movement] = await tx
      .insert(materialTransactions)
      .values({
        projectId: input.projectId,
        warehouseId: target.id,
        resourceId: input.resourceId,
        txnType: 'IN',
        txnDate: input.allocatedOn,
        qty: input.qty,
        unitId: resourceRow!.unit_id,
        unitCost,
        refNo: `Alokasi gudang pusat`,
        note: input.note,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning({ id: materialTransactions.id });

    const [created] = await tx
      .insert(warehouseAllocations)
      .values({
        warehouseId,
        projectId: input.projectId,
        resourceId: input.resourceId,
        allocatedOn: input.allocatedOn,
        qty: input.qty,
        unitCost,
        materialTransactionId: movement?.id ?? null,
        note: input.note,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning({ id: warehouseAllocations.id });

    if (!created) throw conflict('Alokasi gagal dicatat.');

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId: input.projectId,
      tableName: 'warehouse_allocations',
      recordId: created.id,
      action: 'INSERT',
      before: null,
      after: { qty: input.qty, unitCost, movementId: movement?.id ?? null },
      actorId: user.id,
    });

    return { id: created.id, unitCost };
  });
}
