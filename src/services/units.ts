import 'server-only';

import { and, asc, count, eq } from 'drizzle-orm';

import { db } from '@/db';
import { withUser } from '@/db/context';
import { resources, units } from '@/db/schema';
import { conflict, notFound, validation } from '@/lib/errors';

import { assertOrgAccess } from './org-access';
import { writeAuditLog } from './audit';
import { type SessionUser } from './session';

import { cachedByOrg } from '@/lib/cache';
export type UnitDimension =
  | 'LENGTH'
  | 'AREA'
  | 'VOLUME'
  | 'MASS'
  | 'COUNT'
  | 'TIME'
  | 'LUMPSUM';

export const UNIT_DIMENSION_LABELS: Record<UnitDimension, string> = {
  LENGTH: 'Panjang',
  AREA: 'Luas',
  VOLUME: 'Volume',
  MASS: 'Massa',
  COUNT: 'Jumlah',
  TIME: 'Waktu',
  LUMPSUM: 'Lumpsum',
};

export type UnitRow = {
  id: string;
  code: string;
  name: string;
  dimension: UnitDimension;
  baseUnitId: string | null;
  factorToBase: string;
  usageCount: number;
};

export async function listUnits(userId: string): Promise<UnitRow[]> {
  const access = await assertOrgAccess(userId);
  // Authorisation is re-checked above on every call; only the rows are cached.
  return cachedByOrg('units', access.orgId, () => loadUnits(access.orgId));
}

async function loadUnits(orgId: string): Promise<UnitRow[]> {
  const usage = db.$with('unit_usage').as(
    db
      .select({ unitId: resources.unitId, total: count().as('total') })
      .from(resources)
      .groupBy(resources.unitId),
  );

  const rows = await db
    .with(usage)
    .select({
      id: units.id,
      code: units.code,
      name: units.name,
      dimension: units.dimension,
      baseUnitId: units.baseUnitId,
      factorToBase: units.factorToBase,
      usageCount: usage.total,
    })
    .from(units)
    .leftJoin(usage, eq(usage.unitId, units.id))
    .where(eq(units.orgId, orgId))
    .orderBy(asc(units.code));

  return rows.map((r) => ({ ...r, usageCount: r.usageCount ?? 0 }));
}

export type UnitInput = {
  code: string;
  name: string;
  dimension: UnitDimension;
  baseUnitId?: string | null;
  factorToBase?: string;
};

export async function createUnit(user: SessionUser, input: UnitInput): Promise<{ id: string }> {
  const access = await assertOrgAccess(user.id, 'ADMIN');
  await assertUnitCodeAvailable(access.orgId, input.code, null);
  await assertBaseUnitCompatible(access.orgId, input.baseUnitId ?? null, input.dimension);

  return withUser(user.id, async (tx) => {
    const [created] = await tx
      .insert(units)
      .values({
        orgId: access.orgId,
        code: input.code,
        name: input.name,
        dimension: input.dimension,
        baseUnitId: input.baseUnitId ?? null,
        factorToBase: input.factorToBase ?? '1',
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning({ id: units.id });

    if (!created) throw conflict('Satuan gagal dibuat.');

    await writeAuditLog(tx, {
      orgId: access.orgId,
      tableName: 'units',
      recordId: created.id,
      action: 'INSERT',
      after: input,
      actorId: user.id,
    });

    return { id: created.id };
  });
}

export async function updateUnit(
  user: SessionUser,
  unitId: string,
  input: UnitInput,
): Promise<void> {
  const access = await assertOrgAccess(user.id, 'ADMIN');
  const before = await requireUnit(access.orgId, unitId);

  if (before.code !== input.code) {
    await assertUnitCodeAvailable(access.orgId, input.code, unitId);
  }

  // Charter rule 8: units may only be converted within one dimension. Moving a
  // unit between dimensions would silently reinterpret every quantity already
  // recorded against it.
  if (before.dimension !== input.dimension) {
    const [inUse] = await db
      .select({ value: count() })
      .from(resources)
      .where(eq(resources.unitId, unitId));

    if ((inUse?.value ?? 0) > 0) {
      throw validation(
        `Dimensi satuan "${before.code}" tidak dapat diubah karena sudah dipakai oleh ${inUse?.value} sumber daya.`,
        'Buat satuan baru dengan dimensi yang benar, lalu pindahkan sumber dayanya satu per satu.',
      );
    }
  }

  await assertBaseUnitCompatible(access.orgId, input.baseUnitId ?? null, input.dimension, unitId);

  await withUser(user.id, async (tx) => {
    await tx
      .update(units)
      .set({
        code: input.code,
        name: input.name,
        dimension: input.dimension,
        baseUnitId: input.baseUnitId ?? null,
        factorToBase: input.factorToBase ?? '1',
        updatedBy: user.id,
      })
      .where(eq(units.id, unitId));

    await writeAuditLog(tx, {
      orgId: access.orgId,
      tableName: 'units',
      recordId: unitId,
      action: 'UPDATE',
      before,
      after: input,
      actorId: user.id,
    });
  });
}

export async function deleteUnit(user: SessionUser, unitId: string): Promise<void> {
  const access = await assertOrgAccess(user.id, 'ADMIN');
  const before = await requireUnit(access.orgId, unitId);

  const [inUse] = await db
    .select({ value: count() })
    .from(resources)
    .where(eq(resources.unitId, unitId));

  if ((inUse?.value ?? 0) > 0) {
    throw conflict(
      `Satuan "${before.code}" tidak dapat dihapus karena dipakai oleh ${inUse?.value} sumber daya.`,
      'Ubah satuan sumber daya tersebut terlebih dahulu.',
    );
  }

  await withUser(user.id, async (tx) => {
    await writeAuditLog(tx, {
      orgId: access.orgId,
      tableName: 'units',
      recordId: unitId,
      action: 'DELETE',
      before,
      actorId: user.id,
    });
    await tx.delete(units).where(eq(units.id, unitId));
  });
}

async function requireUnit(orgId: string, unitId: string) {
  const [row] = await db
    .select()
    .from(units)
    .where(and(eq(units.id, unitId), eq(units.orgId, orgId)))
    .limit(1);

  if (!row) throw notFound('Satuan tidak ditemukan.');
  return row;
}

async function assertUnitCodeAvailable(
  orgId: string,
  code: string,
  exceptId: string | null,
): Promise<void> {
  const [existing] = await db
    .select({ id: units.id })
    .from(units)
    .where(and(eq(units.orgId, orgId), eq(units.code, code)))
    .limit(1);

  if (existing && existing.id !== exceptId) {
    throw conflict(`Kode satuan "${code}" sudah dipakai.`, 'Kode satuan harus unik dalam organisasi.');
  }
}

/** A base unit must measure the same thing, or conversion is meaningless. */
async function assertBaseUnitCompatible(
  orgId: string,
  baseUnitId: string | null,
  dimension: UnitDimension,
  selfId?: string,
): Promise<void> {
  if (baseUnitId === null) return;

  if (selfId && baseUnitId === selfId) {
    throw validation('Satuan tidak dapat menjadi satuan dasar bagi dirinya sendiri.');
  }

  const base = await requireUnit(orgId, baseUnitId);
  if (base.dimension !== dimension) {
    throw validation(
      `Satuan dasar "${base.code}" berdimensi ${UNIT_DIMENSION_LABELS[base.dimension]}, sedangkan satuan ini ${UNIT_DIMENSION_LABELS[dimension]}.`,
      'Konversi hanya boleh dilakukan dalam dimensi yang sama.',
    );
  }
}
