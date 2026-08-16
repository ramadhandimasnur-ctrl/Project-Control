import 'server-only';

import { and, asc, count, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { db } from '@/db';
import { withUser } from '@/db/context';
import {
  materialTransactions,
  progressEntries,
  units,
  volumeTakeoffs,
  workGroups,
  workItemResources,
  workItems,
} from '@/db/schema';
import { toDecimal } from '@/lib/calc/decimal';
import { conflict, notFound } from '@/lib/errors';
import {
  type WorkGroupFormValues,
  type WorkItemFormValues,
} from '@/lib/validation/work-breakdown';

import { assertProjectAccess } from './access';
import { writeAuditLog } from './audit';
import { type SessionUser } from './session';

export type WorkGroupRow = {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  itemCount: number;
};

export async function listWorkGroups(
  userId: string,
  projectId: string,
): Promise<WorkGroupRow[]> {
  await assertProjectAccess(userId, projectId, 'VIEWER');

  const usage = db.$with('group_usage').as(
    db
      .select({ groupId: workItems.groupId, total: count().as('total') })
      .from(workItems)
      .where(eq(workItems.projectId, projectId))
      .groupBy(workItems.groupId),
  );

  const rows = await db
    .with(usage)
    .select({
      id: workGroups.id,
      code: workGroups.code,
      name: workGroups.name,
      parentId: workGroups.parentId,
      sortOrder: workGroups.sortOrder,
      itemCount: usage.total,
    })
    .from(workGroups)
    .leftJoin(usage, eq(usage.groupId, workGroups.id))
    .where(eq(workGroups.projectId, projectId))
    .orderBy(asc(workGroups.sortOrder), asc(workGroups.code));

  return rows.map((r) => ({ ...r, itemCount: r.itemCount ?? 0 }));
}

export async function createWorkGroup(
  user: SessionUser,
  projectId: string,
  values: WorkGroupFormValues,
): Promise<{ id: string }> {
  const access = await assertProjectAccess(user.id, projectId, 'ENGINEER');
  await assertGroupCodeAvailable(projectId, values.code, null);

  return withUser(user.id, async (tx) => {
    const [created] = await tx
      .insert(workGroups)
      .values({ ...values, projectId, createdBy: user.id, updatedBy: user.id })
      .returning({ id: workGroups.id });

    if (!created) throw conflict('Kelompok pekerjaan gagal dibuat.');

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'work_groups',
      recordId: created.id,
      action: 'INSERT',
      after: values,
      actorId: user.id,
    });

    return { id: created.id };
  });
}

export async function updateWorkGroup(
  user: SessionUser,
  projectId: string,
  groupId: string,
  values: WorkGroupFormValues,
): Promise<void> {
  const access = await assertProjectAccess(user.id, projectId, 'ENGINEER');
  const before = await requireGroup(projectId, groupId);

  if (before.code !== values.code) {
    await assertGroupCodeAvailable(projectId, values.code, groupId);
  }
  if (values.parentId === groupId) {
    throw conflict('Kelompok tidak dapat menjadi induk bagi dirinya sendiri.');
  }

  await withUser(user.id, async (tx) => {
    await tx
      .update(workGroups)
      .set({ ...values, updatedBy: user.id })
      .where(eq(workGroups.id, groupId));

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'work_groups',
      recordId: groupId,
      action: 'UPDATE',
      before,
      after: values,
      actorId: user.id,
    });
  });
}

export async function deleteWorkGroup(
  user: SessionUser,
  projectId: string,
  groupId: string,
): Promise<void> {
  const access = await assertProjectAccess(user.id, projectId, 'ENGINEER');
  const before = await requireGroup(projectId, groupId);

  const [used] = await db
    .select({ value: count() })
    .from(workItems)
    .where(eq(workItems.groupId, groupId));

  if ((used?.value ?? 0) > 0) {
    throw conflict(
      `Kelompok "${before.name}" masih berisi ${used?.value} pekerjaan.`,
      'Pindahkan pekerjaan tersebut ke kelompok lain terlebih dahulu.',
    );
  }

  await withUser(user.id, async (tx) => {
    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'work_groups',
      recordId: groupId,
      action: 'DELETE',
      before,
      actorId: user.id,
    });
    await tx.delete(workGroups).where(eq(workGroups.id, groupId));
  });
}

// ---------------------------------------------------------------------------
// Work items
// ---------------------------------------------------------------------------

export type WorkItemRow = {
  id: string;
  code: string;
  name: string;
  spec: string | null;
  groupId: string | null;
  groupName: string | null;
  unitId: string;
  unitCode: string;
  volume: string;
  /** Null when execution builds exactly the contracted volume. */
  volumeRap: string | null;
  unitRapId: string | null;
  /** Falls back to the RAB unit when execution measures the same way. */
  unitRapCode: string;
  contractUnitPrice: string | null;
  unitPriceRab: string | null;
  unitPriceRap: string | null;
  priceMarkupPercent: string | null;
  progressMethod: 'VOLUME' | 'PERCENT' | 'MILESTONE';
  includeInProgressWeight: boolean;
  sortOrder: number;
  isActive: boolean;
  /** Number of AHSP lines; zero means the item has no analysis yet. */
  lineCount: number;
  /** True when volume is derived from take-off rows rather than typed. */
  hasTakeoffs: boolean;
};

/** The units table joined a second time, for the execution unit. */
const unitRap = alias(units, 'unit_rap');

export async function listWorkItems(userId: string, projectId: string): Promise<WorkItemRow[]> {
  await assertProjectAccess(userId, projectId, 'VIEWER');

  // Each CTE needs its own column alias. Two CTEs both exposing "total" make
  // the outer references ambiguous, and Postgres rejects the whole query.
  const lines = db.$with('line_counts').as(
    db
      .select({ workItemId: workItemResources.workItemId, lineTotal: count().as('line_total') })
      .from(workItemResources)
      .groupBy(workItemResources.workItemId),
  );

  const takeoffs = db.$with('takeoff_counts').as(
    db
      .select({ workItemId: volumeTakeoffs.workItemId, takeoffTotal: count().as('takeoff_total') })
      .from(volumeTakeoffs)
      .groupBy(volumeTakeoffs.workItemId),
  );

  const rows = await db
    .with(lines, takeoffs)
    .select({
      id: workItems.id,
      code: workItems.code,
      name: workItems.name,
      spec: workItems.spec,
      groupId: workItems.groupId,
      groupName: workGroups.name,
      unitId: workItems.unitId,
      unitCode: units.code,
      volume: workItems.volume,
      volumeRap: workItems.volumeRap,
      unitRapId: workItems.unitRapId,
      // Resolved in SQL so every caller gets the same fallback.
      unitRapCode: sql<string>`coalesce(${unitRap.code}, ${units.code})`,
      contractUnitPrice: workItems.contractUnitPrice,
      unitPriceRab: workItems.unitPriceRab,
      unitPriceRap: workItems.unitPriceRap,
      priceMarkupPercent: workItems.priceMarkupPercent,
      progressMethod: workItems.progressMethod,
      includeInProgressWeight: workItems.includeInProgressWeight,
      sortOrder: workItems.sortOrder,
      isActive: workItems.isActive,
      lineCount: lines.lineTotal,
      takeoffCount: takeoffs.takeoffTotal,
    })
    .from(workItems)
    .innerJoin(units, eq(units.id, workItems.unitId))
    .leftJoin(unitRap, eq(unitRap.id, workItems.unitRapId))
    .leftJoin(workGroups, eq(workGroups.id, workItems.groupId))
    .leftJoin(lines, eq(lines.workItemId, workItems.id))
    .leftJoin(takeoffs, eq(takeoffs.workItemId, workItems.id))
    .where(eq(workItems.projectId, projectId))
    .orderBy(asc(workItems.sortOrder), asc(workItems.code));

  return rows.map(({ takeoffCount, ...r }) => ({
    ...r,
    lineCount: r.lineCount ?? 0,
    hasTakeoffs: (takeoffCount ?? 0) > 0,
  }));
}

export async function getWorkItem(
  userId: string,
  projectId: string,
  workItemId: string,
): Promise<WorkItemRow> {
  const items = await listWorkItems(userId, projectId);
  const item = items.find((i) => i.id === workItemId);
  if (!item) throw notFound('Pekerjaan tidak ditemukan.');
  return item;
}

/**
 * Form values as the columns store them.
 *
 * The markup is typed as a percentage and stored as a fraction — the same
 * convention every other percent column follows, so a report that multiplies
 * by 100 once gets the right answer wherever the figure came from.
 */
function toColumns(values: WorkItemFormValues) {
  return {
    ...values,
    priceMarkupPercent:
      values.priceMarkupPercent === null
        ? null
        : toDecimal(values.priceMarkupPercent).dividedBy(100).toString(),
  };
}

export async function createWorkItem(
  user: SessionUser,
  projectId: string,
  values: WorkItemFormValues,
): Promise<{ id: string }> {
  const access = await assertProjectAccess(user.id, projectId, 'ENGINEER');
  await assertItemCodeAvailable(projectId, values.code, null);

  return withUser(user.id, async (tx) => {
    const [created] = await tx
      .insert(workItems)
      .values({ ...toColumns(values), projectId, createdBy: user.id, updatedBy: user.id })
      .returning({ id: workItems.id });

    if (!created) throw conflict('Pekerjaan gagal dibuat.');

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'work_items',
      recordId: created.id,
      action: 'INSERT',
      after: values,
      actorId: user.id,
    });

    return { id: created.id };
  });
}

export async function updateWorkItem(
  user: SessionUser,
  projectId: string,
  workItemId: string,
  values: WorkItemFormValues,
): Promise<void> {
  const access = await assertProjectAccess(user.id, projectId, 'ENGINEER');
  const before = await getWorkItem(user.id, projectId, workItemId);

  if (before.code !== values.code) {
    await assertItemCodeAvailable(projectId, values.code, workItemId);
  }

  // Volume is derived when take-off rows exist; letting the form overwrite it
  // would make the stored figure disagree with its own working.
  const volume = before.hasTakeoffs ? before.volume : values.volume;

  await withUser(user.id, async (tx) => {
    await tx
      .update(workItems)
      .set({ ...toColumns(values), volume, updatedBy: user.id })
      .where(eq(workItems.id, workItemId));

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'work_items',
      recordId: workItemId,
      action: 'UPDATE',
      before,
      after: { ...values, volume },
      actorId: user.id,
    });
  });
}

export type WorkItemDeletionImpact = {
  ahspLines: number;
  takeoffs: number;
  progressEntries: number;
  materialTransactions: number;
};

/** Feeds the confirmation dialog, which must name what it is about to destroy. */
export async function getWorkItemDeletionImpact(
  userId: string,
  projectId: string,
  workItemId: string,
): Promise<WorkItemDeletionImpact> {
  await assertProjectAccess(userId, projectId, 'ENGINEER');

  const [row] = await withUser(userId, (tx) =>
    tx.execute<{
      ahsp_lines: number;
      takeoffs: number;
      progress_entries: number;
      material_transactions: number;
    }>(sql`
      SELECT
        (SELECT count(*)::int FROM ${workItemResources}   WHERE work_item_id = ${workItemId}) AS ahsp_lines,
        (SELECT count(*)::int FROM ${volumeTakeoffs}      WHERE work_item_id = ${workItemId}) AS takeoffs,
        (SELECT count(*)::int FROM ${progressEntries}     WHERE work_item_id = ${workItemId}) AS progress_entries,
        (SELECT count(*)::int FROM ${materialTransactions} WHERE work_item_id = ${workItemId}) AS material_transactions
    `),
  );

  return {
    ahspLines: row?.ahsp_lines ?? 0,
    takeoffs: row?.takeoffs ?? 0,
    progressEntries: row?.progress_entries ?? 0,
    materialTransactions: row?.material_transactions ?? 0,
  };
}

export async function deleteWorkItem(
  user: SessionUser,
  projectId: string,
  workItemId: string,
): Promise<void> {
  const access = await assertProjectAccess(user.id, projectId, 'ENGINEER');
  const before = await getWorkItem(user.id, projectId, workItemId);
  const impact = await getWorkItemDeletionImpact(user.id, projectId, workItemId);

  // Progress and stock movements are records of what happened on site. Once
  // they exist the work item is history, not a draft.
  if (impact.progressEntries > 0 || impact.materialTransactions > 0) {
    throw conflict(
      `"${before.name}" tidak dapat dihapus karena sudah memiliki ${impact.progressEntries} entri progres dan ${impact.materialTransactions} transaksi material.`,
      'Nonaktifkan pekerjaan ini agar tidak muncul lagi, tanpa menghapus catatan lapangan.',
    );
  }

  await withUser(user.id, async (tx) => {
    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'work_items',
      recordId: workItemId,
      action: 'DELETE',
      before: { ...before, impact },
      actorId: user.id,
    });
    await tx.delete(workItems).where(eq(workItems.id, workItemId));
  });
}

export type DuplicateOptions = {
  code: string;
  name: string;
  /** Copy the volume take-off rows too, and with them the derived volume. */
  includeTakeoffs?: boolean;
};

/**
 * Copies a work item together with its analysis.
 *
 * What is deliberately not copied: progress entries, material movements and
 * schedule rows. Those record what happened to the original, and carrying them
 * over would fabricate history for a work item that has not been built yet.
 */
export async function duplicateWorkItem(
  user: SessionUser,
  projectId: string,
  workItemId: string,
  options: DuplicateOptions,
): Promise<{ id: string }> {
  const access = await assertProjectAccess(user.id, projectId, 'ENGINEER');
  const source = await getWorkItem(user.id, projectId, workItemId);
  await assertItemCodeAvailable(projectId, options.code, null);

  const [lines, takeoffRows] = await Promise.all([
    db
      .select({
        resourceId: workItemResources.resourceId,
        estimateType: workItemResources.estimateType,
        role: workItemResources.role,
        coef: workItemResources.coef,
        wasteFactor: workItemResources.wasteFactor,
        note: workItemResources.note,
        sortOrder: workItemResources.sortOrder,
      })
      .from(workItemResources)
      .where(eq(workItemResources.workItemId, workItemId)),
    options.includeTakeoffs
      ? db
          .select({
            label: volumeTakeoffs.label,
            expression: volumeTakeoffs.expression,
            qty: volumeTakeoffs.qty,
            note: volumeTakeoffs.note,
            sortOrder: volumeTakeoffs.sortOrder,
          })
          .from(volumeTakeoffs)
          .where(eq(volumeTakeoffs.workItemId, workItemId))
      : Promise.resolve([]),
  ]);

  return withUser(user.id, async (tx) => {
    const [created] = await tx
      .insert(workItems)
      .values({
        projectId,
        groupId: source.groupId,
        code: options.code,
        name: options.name,
        spec: source.spec,
        unitId: source.unitId,
        volume: source.volume,
        volumeRap: source.volumeRap,
        contractUnitPrice: source.contractUnitPrice,
        unitPriceRab: source.unitPriceRab,
        unitPriceRap: source.unitPriceRap,
        priceMarkupPercent: source.priceMarkupPercent,
        progressMethod: source.progressMethod,
        includeInProgressWeight: source.includeInProgressWeight,
        sortOrder: source.sortOrder,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning({ id: workItems.id });

    if (!created) throw conflict('Duplikat pekerjaan gagal dibuat.');

    if (lines.length > 0) {
      await tx.insert(workItemResources).values(
        lines.map((line) => ({
          ...line,
          workItemId: created.id,
          createdBy: user.id,
          updatedBy: user.id,
        })),
      );
    }

    if (takeoffRows.length > 0) {
      await tx.insert(volumeTakeoffs).values(
        takeoffRows.map((row) => ({
          ...row,
          workItemId: created.id,
          createdBy: user.id,
          updatedBy: user.id,
        })),
      );
    }

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'work_items',
      recordId: created.id,
      action: 'INSERT',
      after: {
        duplicatedFrom: workItemId,
        code: options.code,
        name: options.name,
        ahspLines: lines.length,
        takeoffs: takeoffRows.length,
      },
      actorId: user.id,
    });

    return { id: created.id };
  });
}

export async function setWorkItemActive(
  user: SessionUser,
  projectId: string,
  workItemId: string,
  isActive: boolean,
): Promise<void> {
  const access = await assertProjectAccess(user.id, projectId, 'ENGINEER');
  await getWorkItem(user.id, projectId, workItemId);

  await withUser(user.id, async (tx) => {
    await tx
      .update(workItems)
      .set({ isActive, updatedBy: user.id })
      .where(eq(workItems.id, workItemId));

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'work_items',
      recordId: workItemId,
      action: 'UPDATE',
      after: { isActive },
      actorId: user.id,
    });
  });
}

// --- helpers ----------------------------------------------------------------

async function requireGroup(projectId: string, groupId: string) {
  const [row] = await db
    .select()
    .from(workGroups)
    .where(and(eq(workGroups.id, groupId), eq(workGroups.projectId, projectId)))
    .limit(1);

  if (!row) throw notFound('Kelompok pekerjaan tidak ditemukan.');
  return row;
}

async function assertGroupCodeAvailable(
  projectId: string,
  code: string,
  exceptId: string | null,
): Promise<void> {
  const [existing] = await db
    .select({ id: workGroups.id, name: workGroups.name })
    .from(workGroups)
    .where(and(eq(workGroups.projectId, projectId), eq(workGroups.code, code)))
    .limit(1);

  if (existing && existing.id !== exceptId) {
    throw conflict(`Kode kelompok "${code}" sudah dipakai oleh "${existing.name}".`);
  }
}

async function assertItemCodeAvailable(
  projectId: string,
  code: string,
  exceptId: string | null,
): Promise<void> {
  const [existing] = await db
    .select({ id: workItems.id, name: workItems.name })
    .from(workItems)
    .where(and(eq(workItems.projectId, projectId), eq(workItems.code, code)))
    .limit(1);

  if (existing && existing.id !== exceptId) {
    throw conflict(
      `Kode pekerjaan "${code}" sudah dipakai oleh "${existing.name}".`,
      'Kode pekerjaan harus unik dalam satu proyek.',
    );
  }
}
