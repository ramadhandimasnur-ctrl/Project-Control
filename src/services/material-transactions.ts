import 'server-only';

import { and, asc, desc, eq } from 'drizzle-orm';

import { db } from '@/db';
import { withUser } from '@/db/context';
import {
  materialTransactions,
  projects,
  resources,
  units,
  warehouses,
  workItems,
} from '@/db/schema';
import { type Decimal, toQuantityString } from '@/lib/calc/decimal';
import {
  inventoryPosition,
  signedQty,
  type InventoryMovement,
  type MovementType,
} from '@/lib/calc/inventory';
import { convertQuantity, type ConvertibleUnit } from '@/lib/calc/unit-conversion';
import { conflict, notFound, validation } from '@/lib/errors';

import { assertProjectAccess } from './access';
import { writeAuditLog } from './audit';
import { type SessionUser } from './session';

/**
 * Warehouse movements — the append-only ledger behind every stock figure.
 *
 * Nothing here updates a running total. Stock and average cost are replayed
 * from these rows on demand (charter rule 4), which is why the database also
 * refuses to let the four costing fields be edited after the fact.
 */

export type MovementRow = {
  id: string;
  txnType: MovementType;
  txnDate: string;
  qty: string;
  unitCode: string;
  unitCost: string | null;
  resourceId: string;
  resourceCode: string;
  resourceName: string;
  warehouseId: string;
  warehouseName: string;
  workItemId: string | null;
  workItemCode: string | null;
  refNo: string | null;
  note: string | null;
  isVoid: boolean;
  voidReason: string | null;
};

export async function listMovements(
  userId: string,
  projectId: string,
  filters: { resourceId?: string; warehouseId?: string; includeVoid?: boolean } = {},
): Promise<MovementRow[]> {
  await assertProjectAccess(userId, projectId, 'VIEWER');

  const conditions = [eq(materialTransactions.projectId, projectId)];
  if (filters.resourceId) conditions.push(eq(materialTransactions.resourceId, filters.resourceId));
  if (filters.warehouseId) {
    conditions.push(eq(materialTransactions.warehouseId, filters.warehouseId));
  }
  if (!filters.includeVoid) conditions.push(eq(materialTransactions.isVoid, false));

  return db
    .select({
      id: materialTransactions.id,
      txnType: materialTransactions.txnType,
      txnDate: materialTransactions.txnDate,
      qty: materialTransactions.qty,
      unitCode: units.code,
      unitCost: materialTransactions.unitCost,
      resourceId: materialTransactions.resourceId,
      resourceCode: resources.code,
      resourceName: resources.name,
      warehouseId: materialTransactions.warehouseId,
      warehouseName: warehouses.name,
      workItemId: materialTransactions.workItemId,
      workItemCode: workItems.code,
      refNo: materialTransactions.refNo,
      note: materialTransactions.note,
      isVoid: materialTransactions.isVoid,
      voidReason: materialTransactions.voidReason,
    })
    .from(materialTransactions)
    .innerJoin(resources, eq(resources.id, materialTransactions.resourceId))
    .innerJoin(units, eq(units.id, materialTransactions.unitId))
    .innerJoin(warehouses, eq(warehouses.id, materialTransactions.warehouseId))
    .leftJoin(workItems, eq(workItems.id, materialTransactions.workItemId))
    .where(and(...conditions))
    .orderBy(desc(materialTransactions.txnDate), desc(materialTransactions.createdAt));
}

/** Movements of one resource in one warehouse, oldest first, for replay. */
export async function loadLedger(
  resourceId: string,
  warehouseId: string,
): Promise<InventoryMovement[]> {
  const rows = await db
    .select({
      txnType: materialTransactions.txnType,
      qty: materialTransactions.qty,
      unitCost: materialTransactions.unitCost,
      txnDate: materialTransactions.txnDate,
      isVoid: materialTransactions.isVoid,
    })
    .from(materialTransactions)
    .where(
      and(
        eq(materialTransactions.resourceId, resourceId),
        eq(materialTransactions.warehouseId, warehouseId),
        eq(materialTransactions.isVoid, false),
      ),
    )
    .orderBy(asc(materialTransactions.txnDate), asc(materialTransactions.createdAt));

  return rows.map((row, index) => ({ ...row, sequence: index }));
}

export type StockPosition = {
  qty: string;
  averageCost: string;
  value: string;
  received: string;
  issued: string;
};

export async function getStockPosition(
  userId: string,
  projectId: string,
  resourceId: string,
  warehouseId: string,
): Promise<StockPosition> {
  await assertProjectAccess(userId, projectId, 'VIEWER');

  const position = inventoryPosition(await loadLedger(resourceId, warehouseId));
  return {
    qty: position.qty.toFixed(4),
    averageCost: position.averageCost.toFixed(2),
    value: position.value.toFixed(2),
    received: position.received.toFixed(4),
    issued: position.issued.toFixed(4),
  };
}

export type MovementInput = {
  txnType: MovementType;
  txnDate: string;
  resourceId: string;
  warehouseId: string;
  qty: string;
  /** Unit the quantity was counted in; converted to the resource's own unit. */
  unitId: string;
  unitCost?: string | null;
  workItemId?: string | null;
  refNo?: string | null;
  note?: string | null;
};

/**
 * Records a movement by hand — a goods issue, a return, a stock count.
 *
 * Receipts from a purchase are not written here: those come from posting the
 * purchase, so that stock and cash are committed together.
 */
export async function recordMovement(
  user: SessionUser,
  projectId: string,
  input: MovementInput,
): Promise<{ id: string }> {
  const access = await assertProjectAccess(user.id, projectId, 'FIELD_USER');

  if (input.txnType === 'IN') {
    throw validation(
      'Penerimaan barang dicatat lewat POST pembelian, bukan sebagai mutasi manual.',
      'Dengan begitu stok dan kas tercatat bersamaan dan tidak dapat berbeda.',
    );
  }

  // Charter section 4.6: issuing material must always name what consumed it.
  if (input.txnType === 'OUT' && !input.workItemId) {
    throw validation(
      'Pengeluaran material harus menyebutkan pekerjaan yang memakainya.',
      'Tanpa itu, pemakaian tidak dapat dibandingkan dengan progres.',
    );
  }

  const [resource] = await db
    .select({
      id: resources.id,
      name: resources.name,
      orgId: resources.orgId,
      unitId: resources.unitId,
    })
    .from(resources)
    .where(eq(resources.id, input.resourceId))
    .limit(1);

  if (!resource || resource.orgId !== access.orgId) {
    throw notFound('Sumber daya tidak ditemukan di organisasi ini.');
  }

  const [warehouse] = await db
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(and(eq(warehouses.id, input.warehouseId), eq(warehouses.projectId, projectId)))
    .limit(1);

  if (!warehouse) throw notFound('Gudang tidak ditemukan di proyek ini.');

  const converted = await convertToResourceUnit(input.unitId, resource.unitId, input.qty, resource.name);

  if (input.workItemId) {
    const [workItem] = await db
      .select({ id: workItems.id })
      .from(workItems)
      .where(and(eq(workItems.id, input.workItemId), eq(workItems.projectId, projectId)))
      .limit(1);
    if (!workItem) throw notFound('Pekerjaan tidak ditemukan di proyek ini.');
  }

  await assertStockRemains(projectId, input, converted, resource.name);

  return withUser(user.id, async (tx) => {
    const [created] = await tx
      .insert(materialTransactions)
      .values({
        projectId,
        warehouseId: input.warehouseId,
        resourceId: input.resourceId,
        txnType: input.txnType,
        txnDate: input.txnDate,
        qty: toQuantityString(converted),
        unitId: resource.unitId,
        unitCost: input.unitCost ?? null,
        workItemId: input.workItemId ?? null,
        refNo: input.refNo ?? null,
        note: input.note ?? null,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning({ id: materialTransactions.id });

    if (!created) throw conflict('Mutasi material gagal dicatat.');

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'material_transactions',
      recordId: created.id,
      action: 'INSERT',
      after: { ...input, qtyInResourceUnit: toQuantityString(converted) },
      actorId: user.id,
    });

    return { id: created.id };
  });
}

/**
 * Cancels a movement.
 *
 * The row stays and is marked, because the database refuses to delete it and
 * because the ledger has to keep showing what was recorded and when it was
 * withdrawn (charter rule 6).
 */
export async function voidMovement(
  user: SessionUser,
  projectId: string,
  movementId: string,
  reason: string,
): Promise<void> {
  const access = await assertProjectAccess(user.id, projectId, 'ENGINEER');

  if (reason.trim() === '') {
    throw validation('Alasan pembatalan wajib diisi.', 'Jejak audit harus menjelaskan mengapa.');
  }

  const [movement] = await db
    .select({
      id: materialTransactions.id,
      isVoid: materialTransactions.isVoid,
      purchaseItemId: materialTransactions.purchaseItemId,
    })
    .from(materialTransactions)
    .where(
      and(eq(materialTransactions.id, movementId), eq(materialTransactions.projectId, projectId)),
    )
    .limit(1);

  if (!movement) throw notFound('Mutasi material tidak ditemukan.');
  if (movement.isVoid) throw conflict('Mutasi ini sudah dibatalkan.');

  // A receipt belongs to its purchase; cancelling it alone would leave stock
  // and cash disagreeing.
  if (movement.purchaseItemId !== null) {
    throw conflict(
      'Mutasi ini berasal dari pembelian, sehingga tidak dapat dibatalkan sendiri.',
      'Batalkan (VOID) pembeliannya, agar stok dan kas ikut terkoreksi bersamaan.',
    );
  }

  await withUser(user.id, async (tx) => {
    await tx
      .update(materialTransactions)
      .set({ isVoid: true, voidReason: reason, voidedBy: user.id, voidedAt: new Date() })
      .where(eq(materialTransactions.id, movementId));

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'material_transactions',
      recordId: movementId,
      action: 'VOID',
      after: { reason },
      actorId: user.id,
    });
  });
}

// --- helpers ----------------------------------------------------------------

async function convertToResourceUnit(
  fromUnitId: string,
  toUnitId: string,
  qty: string,
  resourceName: string,
) {
  const rows = await db
    .select({
      id: units.id,
      code: units.code,
      dimension: units.dimension,
      factorToBase: units.factorToBase,
    })
    .from(units)
    .where(eq(units.id, fromUnitId));

  const [from] = rows;
  const [to] =
    fromUnitId === toUnitId
      ? rows
      : await db
          .select({
            id: units.id,
            code: units.code,
            dimension: units.dimension,
            factorToBase: units.factorToBase,
          })
          .from(units)
          .where(eq(units.id, toUnitId));

  if (!from || !to) throw notFound('Satuan tidak ditemukan.');

  const asConvertible = (u: typeof from): ConvertibleUnit => ({
    code: u.code,
    dimension: u.dimension,
    factorToBase: u.factorToBase,
  });

  const result = convertQuantity(qty, asConvertible(from), asConvertible(to));
  if (!result.ok) {
    throw validation(`"${resourceName}": ${result.message}`, result.hint);
  }
  return result.value;
}

/**
 * Refuses a movement that would drive stock below zero.
 *
 * Controlled by `projects.allow_negative_stock`, which defaults to false:
 * negative stock almost always means a receipt was never recorded, and letting
 * it through hides the omission instead of surfacing it.
 */
async function assertStockRemains(
  projectId: string,
  input: MovementInput,
  convertedQty: Decimal,
  resourceName: string,
): Promise<void> {
  const [project] = await db
    .select({ allowNegativeStock: projects.allowNegativeStock })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (project?.allowNegativeStock) return;

  const delta = signedQty({
    txnType: input.txnType,
    qty: convertedQty,
    txnDate: input.txnDate,
  });

  if (!delta.isNegative()) return;

  const current = inventoryPosition(await loadLedger(input.resourceId, input.warehouseId));
  const after = current.qty.plus(delta);

  if (after.isNegative()) {
    throw validation(
      `Stok "${resourceName}" tidak mencukupi: tersedia ${current.qty.toFixed(4)}, diminta ${delta.abs().toFixed(4)}.`,
      'Catat penerimaan barangnya terlebih dahulu, atau aktifkan "Izinkan stok negatif" di Pengaturan proyek bila memang disengaja.',
    );
  }
}
