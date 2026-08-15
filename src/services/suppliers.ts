import 'server-only';

import { and, asc, count, eq } from 'drizzle-orm';

import { db } from '@/db';
import { withUser } from '@/db/context';
import { purchases, suppliers } from '@/db/schema';
import { conflict, notFound } from '@/lib/errors';

import { assertOrgAccess } from './org-access';
import { writeAuditLog } from './audit';
import { type SessionUser } from './session';

export type SupplierRow = {
  id: string;
  code: string;
  name: string;
  contact: string | null;
  address: string | null;
  creditDays: number;
  note: string | null;
  purchaseCount: number;
};

export async function listSuppliers(userId: string): Promise<SupplierRow[]> {
  const access = await assertOrgAccess(userId);

  const usage = db.$with('supplier_usage').as(
    db
      .select({ supplierId: purchases.supplierId, total: count().as('total') })
      .from(purchases)
      .groupBy(purchases.supplierId),
  );

  const rows = await db
    .with(usage)
    .select({
      id: suppliers.id,
      code: suppliers.code,
      name: suppliers.name,
      contact: suppliers.contact,
      address: suppliers.address,
      creditDays: suppliers.creditDays,
      note: suppliers.note,
      purchaseCount: usage.total,
    })
    .from(suppliers)
    .leftJoin(usage, eq(usage.supplierId, suppliers.id))
    .where(eq(suppliers.orgId, access.orgId))
    .orderBy(asc(suppliers.name));

  return rows.map((r) => ({ ...r, purchaseCount: r.purchaseCount ?? 0 }));
}

export type SupplierInput = {
  code: string;
  name: string;
  contact?: string | null;
  address?: string | null;
  /** Payment terms in days; shifts cash-out in the capital forecast. */
  creditDays?: number;
  note?: string | null;
};

export async function createSupplier(
  user: SessionUser,
  input: SupplierInput,
): Promise<{ id: string }> {
  const access = await assertOrgAccess(user.id, 'ADMIN');
  await assertCodeAvailable(access.orgId, input.code, null);

  return withUser(user.id, async (tx) => {
    const [created] = await tx
      .insert(suppliers)
      .values({
        orgId: access.orgId,
        code: input.code,
        name: input.name,
        contact: input.contact ?? null,
        address: input.address ?? null,
        creditDays: input.creditDays ?? 0,
        note: input.note ?? null,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning({ id: suppliers.id });

    if (!created) throw conflict('Pemasok gagal dibuat.');

    await writeAuditLog(tx, {
      orgId: access.orgId,
      tableName: 'suppliers',
      recordId: created.id,
      action: 'INSERT',
      after: input,
      actorId: user.id,
    });

    return { id: created.id };
  });
}

export async function updateSupplier(
  user: SessionUser,
  supplierId: string,
  input: SupplierInput,
): Promise<void> {
  const access = await assertOrgAccess(user.id, 'ADMIN');
  const before = await requireSupplier(access.orgId, supplierId);

  if (before.code !== input.code) {
    await assertCodeAvailable(access.orgId, input.code, supplierId);
  }

  await withUser(user.id, async (tx) => {
    await tx
      .update(suppliers)
      .set({
        code: input.code,
        name: input.name,
        contact: input.contact ?? null,
        address: input.address ?? null,
        creditDays: input.creditDays ?? 0,
        note: input.note ?? null,
        updatedBy: user.id,
      })
      .where(eq(suppliers.id, supplierId));

    await writeAuditLog(tx, {
      orgId: access.orgId,
      tableName: 'suppliers',
      recordId: supplierId,
      action: 'UPDATE',
      before,
      after: input,
      actorId: user.id,
    });
  });
}

export async function deleteSupplier(user: SessionUser, supplierId: string): Promise<void> {
  const access = await assertOrgAccess(user.id, 'ADMIN');
  const before = await requireSupplier(access.orgId, supplierId);

  const [used] = await db
    .select({ value: count() })
    .from(purchases)
    .where(eq(purchases.supplierId, supplierId));

  if ((used?.value ?? 0) > 0) {
    throw conflict(
      `"${before.name}" tidak dapat dihapus karena tercatat pada ${used?.value} pembelian.`,
      'Riwayat pembelian harus tetap dapat ditelusuri ke pemasoknya.',
    );
  }

  await withUser(user.id, async (tx) => {
    await writeAuditLog(tx, {
      orgId: access.orgId,
      tableName: 'suppliers',
      recordId: supplierId,
      action: 'DELETE',
      before,
      actorId: user.id,
    });
    await tx.delete(suppliers).where(eq(suppliers.id, supplierId));
  });
}

async function requireSupplier(orgId: string, supplierId: string) {
  const [row] = await db
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.id, supplierId), eq(suppliers.orgId, orgId)))
    .limit(1);

  if (!row) throw notFound('Pemasok tidak ditemukan.');
  return row;
}

async function assertCodeAvailable(
  orgId: string,
  code: string,
  exceptId: string | null,
): Promise<void> {
  const [existing] = await db
    .select({ id: suppliers.id, name: suppliers.name })
    .from(suppliers)
    .where(and(eq(suppliers.orgId, orgId), eq(suppliers.code, code)))
    .limit(1);

  if (existing && existing.id !== exceptId) {
    throw conflict(`Kode pemasok "${code}" sudah dipakai oleh "${existing.name}".`);
  }
}
