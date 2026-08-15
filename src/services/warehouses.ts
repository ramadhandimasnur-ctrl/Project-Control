import 'server-only';

import { and, asc, count, eq, ne } from 'drizzle-orm';

import { db } from '@/db';
import { withUser } from '@/db/context';
import { materialTransactions, purchaseItems, warehouses } from '@/db/schema';
import { conflict, notFound } from '@/lib/errors';

import { assertProjectAccess } from './access';
import { writeAuditLog } from './audit';
import { type SessionUser } from './session';

export type WarehouseRow = {
  id: string;
  name: string;
  isDefault: boolean;
  movementCount: number;
};

export async function listWarehouses(
  userId: string,
  projectId: string,
): Promise<WarehouseRow[]> {
  await assertProjectAccess(userId, projectId, 'VIEWER');

  const usage = db.$with('warehouse_usage').as(
    db
      .select({
        warehouseId: materialTransactions.warehouseId,
        movementTotal: count().as('movement_total'),
      })
      .from(materialTransactions)
      .where(eq(materialTransactions.projectId, projectId))
      .groupBy(materialTransactions.warehouseId),
  );

  const rows = await db
    .with(usage)
    .select({
      id: warehouses.id,
      name: warehouses.name,
      isDefault: warehouses.isDefault,
      movementCount: usage.movementTotal,
    })
    .from(warehouses)
    .leftJoin(usage, eq(usage.warehouseId, warehouses.id))
    .where(eq(warehouses.projectId, projectId))
    .orderBy(asc(warehouses.name));

  return rows.map((r) => ({ ...r, movementCount: r.movementCount ?? 0 }));
}

export async function saveWarehouse(
  user: SessionUser,
  projectId: string,
  warehouseId: string | null,
  input: { name: string; isDefault: boolean },
): Promise<{ id: string }> {
  const access = await assertProjectAccess(user.id, projectId, 'ENGINEER');

  const [duplicate] = await db
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(and(eq(warehouses.projectId, projectId), eq(warehouses.name, input.name)))
    .limit(1);

  if (duplicate && duplicate.id !== warehouseId) {
    throw conflict(`Gudang bernama "${input.name}" sudah ada di proyek ini.`);
  }

  return withUser(user.id, async (tx) => {
    // Only one default per project; the partial unique index enforces it, so
    // the previous holder is cleared first rather than colliding.
    if (input.isDefault) {
      await tx
        .update(warehouses)
        .set({ isDefault: false, updatedBy: user.id })
        .where(
          and(
            eq(warehouses.projectId, projectId),
            warehouseId === null ? undefined : ne(warehouses.id, warehouseId),
          ),
        );
    }

    let id = warehouseId;

    if (id === null) {
      const [created] = await tx
        .insert(warehouses)
        .values({ projectId, ...input, createdBy: user.id, updatedBy: user.id })
        .returning({ id: warehouses.id });
      if (!created) throw conflict('Gudang gagal dibuat.');
      id = created.id;
    } else {
      await tx
        .update(warehouses)
        .set({ ...input, updatedBy: user.id })
        .where(and(eq(warehouses.id, id), eq(warehouses.projectId, projectId)));
    }

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'warehouses',
      recordId: id,
      action: warehouseId === null ? 'INSERT' : 'UPDATE',
      after: input,
      actorId: user.id,
    });

    return { id };
  });
}

export async function deleteWarehouse(
  user: SessionUser,
  projectId: string,
  warehouseId: string,
): Promise<void> {
  const access = await assertProjectAccess(user.id, projectId, 'ENGINEER');

  const [warehouse] = await db
    .select({ id: warehouses.id, name: warehouses.name })
    .from(warehouses)
    .where(and(eq(warehouses.id, warehouseId), eq(warehouses.projectId, projectId)))
    .limit(1);

  if (!warehouse) throw notFound('Gudang tidak ditemukan.');

  const [movements] = await db
    .select({ value: count() })
    .from(materialTransactions)
    .where(eq(materialTransactions.warehouseId, warehouseId));

  const [purchased] = await db
    .select({ value: count() })
    .from(purchaseItems)
    .where(eq(purchaseItems.warehouseId, warehouseId));

  const used = (movements?.value ?? 0) + (purchased?.value ?? 0);
  if (used > 0) {
    throw conflict(
      `Gudang "${warehouse.name}" tidak dapat dihapus karena tercatat pada ${movements?.value ?? 0} mutasi material dan ${purchased?.value ?? 0} baris pembelian.`,
      'Riwayat pergerakan barang harus tetap dapat ditelusuri ke gudangnya.',
    );
  }

  await withUser(user.id, async (tx) => {
    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'warehouses',
      recordId: warehouseId,
      action: 'DELETE',
      before: warehouse,
      actorId: user.id,
    });
    await tx.delete(warehouses).where(eq(warehouses.id, warehouseId));
  });
}

/** The warehouse a new movement should default to. */
export async function defaultWarehouseId(projectId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(and(eq(warehouses.projectId, projectId), eq(warehouses.isDefault, true)))
    .limit(1);

  if (row) return row.id;

  const [first] = await db
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(eq(warehouses.projectId, projectId))
    .orderBy(asc(warehouses.name))
    .limit(1);

  return first?.id ?? null;
}
