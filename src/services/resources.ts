import 'server-only';

import { and, asc, count, eq, ilike, or, sql } from 'drizzle-orm';

import { db } from '@/db';
import { withUser } from '@/db/context';
import {
  ahspTemplateResources,
  materialTransactions,
  purchaseItems,
  resourceCategories,
  resources,
  units,
  workItemResources,
} from '@/db/schema';
import { type PriceType } from '@/lib/calc/price';
import { todayIso } from '@/lib/date';
import { conflict, notFound, validation } from '@/lib/errors';

import { assertOrgAccess, canViewOrgCosts } from './org-access';
import { writeAuditLog } from './audit';
import { resolvePriceMap } from './prices';
import { type SessionUser } from './session';

export type ResourceType = 'LABOR' | 'MATERIAL' | 'EQUIPMENT' | 'SUBCON' | 'PACKAGE' | 'OVERHEAD';

export type ResourceListItem = {
  id: string;
  code: string;
  name: string;
  spec: string | null;
  type: ResourceType;
  unitCode: string;
  categoryName: string | null;
  isActive: boolean;
  /*
   * The raw foreign keys and the remaining editable fields travel with the row
   * so the list can open an edit dialog already filled in. Fetching them again
   * per row on click would be a request per pencil click, and prefilling from
   * the display names would guess at ids.
   */
  unitId: string;
  categoryId: string | null;
  leadTimeDays: number;
  notes: string | null;
  /** Stored as a fraction; the table shows it as a percentage. */
  priceMarkupPercent: string | null;
  /** null means the price book has no entry in force — shown as "—". */
  priceRab: string | null;
  priceRap: string | null;
};

export type ListResourcesInput = {
  search?: string;
  type?: ResourceType;
  categoryId?: string;
  includeInactive?: boolean;
  /** Prices are resolved as of this date; defaults to today. */
  onDate?: string;
  /** Project scope for price overrides. */
  projectId?: string | null;
  limit?: number;
  offset?: number;
};

/**
 * Catalogue listing with the price actually in force attached.
 *
 * Prices are resolved through the same `resolvePriceMap` the estimate uses, so
 * the figure shown in the catalogue is the figure an AHSP line will pick up —
 * not a separate query that could disagree with it.
 */
export async function listResources(
  userId: string,
  input: ListResourcesInput = {},
): Promise<{ items: ResourceListItem[]; total: number; showCosts: boolean }> {
  const access = await assertOrgAccess(userId);

  const limit = Math.min(Math.max(input.limit ?? 50, 1), 500);
  const offset = Math.max(input.offset ?? 0, 0);
  const onDate = input.onDate ?? todayIso();
  const projectId = input.projectId ?? null;

  const search = input.search?.trim();
  const filters = [eq(resources.orgId, access.orgId)];

  if (!input.includeInactive) filters.push(eq(resources.isActive, true));
  if (input.type) filters.push(eq(resources.type, input.type));
  if (input.categoryId) filters.push(eq(resources.categoryId, input.categoryId));
  if (search) {
    const pattern = `%${search}%`;
    const matches = or(
      ilike(resources.code, pattern),
      ilike(resources.name, pattern),
      ilike(resources.spec, pattern),
    );
    if (matches) filters.push(matches);
  }

  const where = and(...filters);

  /*
   * The count, the page of rows, and the cost permission do not depend on one
   * another, so they are asked for together. Awaited in turn they cost three
   * round trips instead of one — invisible against a local database and the
   * better part of half a second against a remote one.
   */
  const [[totalRow], rows, showCosts] = await Promise.all([
    db.select({ value: count() }).from(resources).where(where),
    db
      .select({
        id: resources.id,
        code: resources.code,
        name: resources.name,
        spec: resources.spec,
        type: resources.type,
        isActive: resources.isActive,
        unitCode: units.code,
        categoryName: resourceCategories.name,
        unitId: resources.unitId,
        categoryId: resources.categoryId,
        leadTimeDays: resources.leadTimeDays,
        notes: resources.notes,
        priceMarkupPercent: resources.priceMarkupPercent,
      })
      .from(resources)
      .innerJoin(units, eq(units.id, resources.unitId))
      .leftJoin(resourceCategories, eq(resourceCategories.id, resources.categoryId))
      .where(where)
      .orderBy(asc(resources.code))
      .limit(limit)
      .offset(offset),
    // Charter rule 7: a user who may not see costs never receives them, rather
    // than receiving them and having the column hidden in the browser.
    // `showCosts` is returned rather than inferred by the caller: a catalogue
    // that simply has no prices yet must not look like a permission denial.
    canViewOrgCosts(userId),
  ]);

  if (!showCosts) {
    return {
      showCosts,
      total: totalRow?.value ?? 0,
      items: rows.map((r) => ({ ...r, priceRab: null, priceRap: null })),
    };
  }

  const ids = rows.map((r) => r.id);
  const [rab, rap] = await Promise.all([
    resolvePriceMap(ids, projectId, 'RAB', onDate),
    resolvePriceMap(ids, projectId, 'RAP', onDate),
  ]);

  return {
    showCosts,
    total: totalRow?.value ?? 0,
    items: rows.map((r) => ({
      ...r,
      priceRab: rab.resolved.get(r.id)?.price.toFixed(2) ?? null,
      priceRap: rap.resolved.get(r.id)?.price.toFixed(2) ?? null,
    })),
  };
}

export type ResourceDetail = typeof resources.$inferSelect & {
  unitCode: string;
  categoryName: string | null;
};

export async function getResource(userId: string, resourceId: string): Promise<ResourceDetail> {
  const access = await assertOrgAccess(userId);

  const [row] = await db
    .select({
      resource: resources,
      unitCode: units.code,
      categoryName: resourceCategories.name,
    })
    .from(resources)
    .innerJoin(units, eq(units.id, resources.unitId))
    .leftJoin(resourceCategories, eq(resourceCategories.id, resources.categoryId))
    .where(eq(resources.id, resourceId))
    .limit(1);

  if (!row || row.resource.orgId !== access.orgId) {
    throw notFound('Sumber daya tidak ditemukan.');
  }

  return { ...row.resource, unitCode: row.unitCode, categoryName: row.categoryName };
}

export type ResourceInput = {
  code: string;
  name: string;
  spec?: string | null;
  type: ResourceType;
  unitId: string;
  categoryId?: string | null;
  leadTimeDays?: number;
  notes?: string | null;
};

export async function createResource(
  user: SessionUser,
  input: ResourceInput,
): Promise<{ id: string }> {
  const access = await assertOrgAccess(user.id, 'ADMIN');
  await assertCodeAvailable(access.orgId, input.code, null);
  await assertUnitBelongsToOrg(access.orgId, input.unitId);

  return withUser(user.id, async (tx) => {
    const [created] = await tx
      .insert(resources)
      .values({
        orgId: access.orgId,
        code: input.code,
        name: input.name,
        spec: input.spec ?? null,
        type: input.type,
        unitId: input.unitId,
        categoryId: input.categoryId ?? null,
        leadTimeDays: input.leadTimeDays ?? 0,
        notes: input.notes ?? null,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning({ id: resources.id });

    if (!created) throw conflict('Sumber daya gagal dibuat.');

    await writeAuditLog(tx, {
      orgId: access.orgId,
      tableName: 'resources',
      recordId: created.id,
      action: 'INSERT',
      after: input,
      actorId: user.id,
    });

    return { id: created.id };
  });
}

export async function updateResource(
  user: SessionUser,
  resourceId: string,
  input: ResourceInput,
): Promise<void> {
  const access = await assertOrgAccess(user.id, 'ADMIN');
  const before = await getResource(user.id, resourceId);

  if (before.code !== input.code) {
    await assertCodeAvailable(access.orgId, input.code, resourceId);
  }
  if (before.unitId !== input.unitId) {
    await assertUnitBelongsToOrg(access.orgId, input.unitId);

    // Changing the unit rewrites the meaning of every coefficient and every
    // recorded quantity that already refers to this resource.
    const usage = await countResourceUsage(resourceId);
    if (usage.total > 0) {
      throw validation(
        `Satuan "${before.unitCode}" tidak dapat diubah karena sumber daya ini sudah dipakai di ${usage.total} tempat.`,
        'Nonaktifkan sumber daya ini lalu buat yang baru dengan satuan yang benar, agar angka lama tetap sahih.',
      );
    }
  }

  await withUser(user.id, async (tx) => {
    await tx
      .update(resources)
      .set({
        code: input.code,
        name: input.name,
        spec: input.spec ?? null,
        type: input.type,
        unitId: input.unitId,
        categoryId: input.categoryId ?? null,
        leadTimeDays: input.leadTimeDays ?? 0,
        notes: input.notes ?? null,
        updatedBy: user.id,
      })
      .where(eq(resources.id, resourceId));

    await writeAuditLog(tx, {
      orgId: access.orgId,
      tableName: 'resources',
      recordId: resourceId,
      action: 'UPDATE',
      before,
      after: input,
      actorId: user.id,
    });
  });
}

export type ResourceUsage = {
  workItems: number;
  ahspTemplates: number;
  materialTransactions: number;
  purchaseItems: number;
  total: number;
};

/**
 * Where a resource is referenced.
 *
 * Charter section 7: a destructive dialog must name its consequence, and a
 * resource in use cannot be deleted at all — the message says how many places
 * hold it rather than reporting a foreign-key violation.
 */
export async function countResourceUsage(resourceId: string): Promise<ResourceUsage> {
  const [row] = await db.execute<{
    work_items: number;
    ahsp_templates: number;
    material_transactions: number;
    purchase_items: number;
  }>(sql`
    SELECT
      /*
       * Distinct owners, not rows. Since the analyses split, one resource used
       * by both the RAB and the RAP of a single work item occupies two rows —
       * and "dipakai pada 2 pekerjaan" would be a plain untruth about a
       * catalogue entry someone is deciding whether to delete.
       */
      (SELECT count(DISTINCT work_item_id)::int FROM ${workItemResources}
         WHERE resource_id = ${resourceId}) AS work_items,
      (SELECT count(DISTINCT template_id)::int FROM ${ahspTemplateResources}
         WHERE resource_id = ${resourceId}) AS ahsp_templates,
      (SELECT count(*)::int FROM ${materialTransactions}  WHERE resource_id = ${resourceId}) AS material_transactions,
      (SELECT count(*)::int FROM ${purchaseItems}         WHERE resource_id = ${resourceId}) AS purchase_items
  `);

  const usage = {
    workItems: row?.work_items ?? 0,
    ahspTemplates: row?.ahsp_templates ?? 0,
    materialTransactions: row?.material_transactions ?? 0,
    purchaseItems: row?.purchase_items ?? 0,
  };

  return {
    ...usage,
    total:
      usage.workItems + usage.ahspTemplates + usage.materialTransactions + usage.purchaseItems,
  };
}

/**
 * Retires a resource without erasing it.
 *
 * Deletion is never offered for something already referenced: past estimates
 * and past stock movements have to keep resolving to the thing they meant.
 */
export async function setResourceActive(
  user: SessionUser,
  resourceId: string,
  isActive: boolean,
): Promise<void> {
  const access = await assertOrgAccess(user.id, 'ADMIN');
  await getResource(user.id, resourceId);

  await withUser(user.id, async (tx) => {
    await tx
      .update(resources)
      .set({ isActive, updatedBy: user.id })
      .where(eq(resources.id, resourceId));

    await writeAuditLog(tx, {
      orgId: access.orgId,
      tableName: 'resources',
      recordId: resourceId,
      action: 'UPDATE',
      after: { isActive },
      actorId: user.id,
    });
  });
}

export async function deleteResource(user: SessionUser, resourceId: string): Promise<void> {
  const access = await assertOrgAccess(user.id, 'ADMIN');
  const before = await getResource(user.id, resourceId);

  const usage = await countResourceUsage(resourceId);
  if (usage.total > 0) {
    const parts = [
      usage.workItems > 0 ? `${usage.workItems} baris analisa pekerjaan` : null,
      usage.ahspTemplates > 0 ? `${usage.ahspTemplates} baris template AHSP` : null,
      usage.materialTransactions > 0 ? `${usage.materialTransactions} transaksi material` : null,
      usage.purchaseItems > 0 ? `${usage.purchaseItems} baris pembelian` : null,
    ].filter((p): p is string => p !== null);

    throw conflict(
      `"${before.name}" tidak dapat dihapus karena masih dipakai di ${parts.join(', ')}.`,
      'Nonaktifkan sumber daya ini agar tidak muncul lagi saat memilih, tanpa mengubah data lama.',
    );
  }

  await withUser(user.id, async (tx) => {
    await writeAuditLog(tx, {
      orgId: access.orgId,
      tableName: 'resources',
      recordId: resourceId,
      action: 'DELETE',
      before,
      actorId: user.id,
    });

    await tx.delete(resources).where(eq(resources.id, resourceId));
  });
}

export type BulkDeleteResult = {
  deleted: number;
  /** Each refusal keeps the reason, so the user learns which and why. */
  refused: { id: string; name: string; reason: string }[];
};

/**
 * Deletes several resources, keeping the guardrail on every one of them.
 *
 * Sequential rather than a single `DELETE ... WHERE id IN (…)`: the rule is
 * per-resource, and one statement would either take the lot or refuse the lot.
 * A user who selected forty rows and had one of them in use should lose the
 * one, not the operation — and should be told which one.
 */
export async function deleteManyResources(
  user: SessionUser,
  resourceIds: readonly string[],
): Promise<BulkDeleteResult> {
  await assertOrgAccess(user.id, 'ADMIN');

  const refused: BulkDeleteResult['refused'] = [];
  let deleted = 0;

  for (const resourceId of resourceIds) {
    try {
      await deleteResource(user, resourceId);
      deleted += 1;
    } catch (error) {
      const [row] = await db
        .select({ name: resources.name })
        .from(resources)
        .where(eq(resources.id, resourceId))
        .limit(1);

      refused.push({
        id: resourceId,
        name: row?.name ?? resourceId,
        reason: error instanceof Error ? error.message : 'Gagal dihapus.',
      });
    }
  }

  return { deleted, refused };
}

async function assertCodeAvailable(
  orgId: string,
  code: string,
  exceptId: string | null,
): Promise<void> {
  const [existing] = await db
    .select({ id: resources.id, name: resources.name })
    .from(resources)
    .where(and(eq(resources.orgId, orgId), eq(resources.code, code)))
    .limit(1);

  if (existing && existing.id !== exceptId) {
    throw conflict(
      `Kode "${code}" sudah dipakai oleh "${existing.name}".`,
      'Kode sumber daya harus unik dalam satu organisasi.',
    );
  }
}

async function assertUnitBelongsToOrg(orgId: string, unitId: string): Promise<void> {
  const [unit] = await db
    .select({ id: units.id })
    .from(units)
    .where(and(eq(units.id, unitId), eq(units.orgId, orgId)))
    .limit(1);

  if (!unit) throw notFound('Satuan tidak ditemukan di organisasi ini.');
}

export type PriceTypeFilter = PriceType | 'BOTH';
