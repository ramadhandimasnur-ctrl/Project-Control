import 'server-only';

import { and, asc, eq } from 'drizzle-orm';

import { db, type Transaction } from '@/db';
import { withUser } from '@/db/context';
import { volumeTakeoffs, workItems } from '@/db/schema';
import { toQuantityString } from '@/lib/calc/decimal';
import { resolveTakeoffQty, takeoffTotal } from '@/lib/calc/volume';
import { conflict, notFound, validation } from '@/lib/errors';
import { type TakeoffFormValues } from '@/lib/validation/work-breakdown';

import { assertProjectAccess } from './access';
import { writeAuditLog } from './audit';
import { type SessionUser } from './session';

export type TakeoffRowView = {
  id: string;
  label: string;
  expression: string | null;
  qty: string;
  note: string | null;
  sortOrder: number;
};

export async function listTakeoffs(
  userId: string,
  projectId: string,
  workItemId: string,
): Promise<TakeoffRowView[]> {
  await assertProjectAccess(userId, projectId, 'VIEWER');

  return withUser(userId, (tx) =>
    tx
      .select({
        id: volumeTakeoffs.id,
        label: volumeTakeoffs.label,
        expression: volumeTakeoffs.expression,
        qty: volumeTakeoffs.qty,
        note: volumeTakeoffs.note,
        sortOrder: volumeTakeoffs.sortOrder,
      })
      .from(volumeTakeoffs)
      .where(eq(volumeTakeoffs.workItemId, workItemId))
      .orderBy(asc(volumeTakeoffs.sortOrder), asc(volumeTakeoffs.label)),
  );
}

/**
 * Recomputes and stores the work item's volume from its take-off rows.
 *
 * Charter section 4.3 makes `work_items.volume` the sum of the take-off rows
 * whenever any exist. That is the one place a derived figure is deliberately
 * stored rather than computed on read, so it has to be rewritten inside the
 * same transaction as any change to the rows — never later, never by a job.
 */
async function syncVolume(tx: Transaction, workItemId: string): Promise<string | null> {
  const rows = await tx
    .select({ qty: volumeTakeoffs.qty })
    .from(volumeTakeoffs)
    .where(eq(volumeTakeoffs.workItemId, workItemId));

  // No rows left: the volume reverts to being entered by hand, and whatever
  // was last derived stays until someone types over it.
  if (rows.length === 0) return null;

  const total = toQuantityString(takeoffTotal(rows));
  await tx.update(workItems).set({ volume: total }).where(eq(workItems.id, workItemId));
  return total;
}

/**
 * Creates or updates one take-off row.
 *
 * When the row carries an expression, the quantity is derived from it rather
 * than trusted from the form: the two must never disagree.
 */
export async function saveTakeoff(
  user: SessionUser,
  projectId: string,
  workItemId: string,
  takeoffId: string | null,
  values: TakeoffFormValues,
): Promise<{ id: string; volume: string | null }> {
  const access = await assertProjectAccess(user.id, projectId, 'ENGINEER');
  await requireWorkItem(projectId, workItemId);

  const resolved = resolveTakeoffQty({ expression: values.expression, qty: values.qty });
  if (!resolved.ok) {
    throw validation(resolved.message, 'Perbaiki ekspresi atau isi kuantitasnya langsung.');
  }
  const qty = toQuantityString(resolved.value);

  return withUser(user.id, async (tx) => {
    let id = takeoffId;

    if (id === null) {
      const [created] = await tx
        .insert(volumeTakeoffs)
        .values({ ...values, qty, workItemId, createdBy: user.id, updatedBy: user.id })
        .returning({ id: volumeTakeoffs.id });

      if (!created) throw conflict('Baris volume gagal dibuat.');
      id = created.id;
    } else {
      await tx
        .update(volumeTakeoffs)
        .set({ ...values, qty, updatedBy: user.id })
        .where(and(eq(volumeTakeoffs.id, id), eq(volumeTakeoffs.workItemId, workItemId)));
    }

    const volume = await syncVolume(tx, workItemId);

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'volume_takeoffs',
      recordId: id,
      action: takeoffId === null ? 'INSERT' : 'UPDATE',
      after: { ...values, qty, volume },
      actorId: user.id,
    });

    return { id, volume };
  });
}

export async function deleteTakeoff(
  user: SessionUser,
  projectId: string,
  workItemId: string,
  takeoffId: string,
): Promise<{ volume: string | null }> {
  const access = await assertProjectAccess(user.id, projectId, 'ENGINEER');
  await requireWorkItem(projectId, workItemId);

  return withUser(user.id, async (tx) => {
    const [before] = await tx
      .select()
      .from(volumeTakeoffs)
      .where(and(eq(volumeTakeoffs.id, takeoffId), eq(volumeTakeoffs.workItemId, workItemId)))
      .limit(1);

    if (!before) throw notFound('Baris volume tidak ditemukan.');

    await tx.delete(volumeTakeoffs).where(eq(volumeTakeoffs.id, takeoffId));
    const volume = await syncVolume(tx, workItemId);

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'volume_takeoffs',
      recordId: takeoffId,
      action: 'DELETE',
      before,
      after: { volume },
      actorId: user.id,
    });

    return { volume };
  });
}

async function requireWorkItem(projectId: string, workItemId: string) {
  const [row] = await db
    .select({ id: workItems.id })
    .from(workItems)
    .where(and(eq(workItems.id, workItemId), eq(workItems.projectId, projectId)))
    .limit(1);

  if (!row) throw notFound('Pekerjaan tidak ditemukan.');
  return row;
}
