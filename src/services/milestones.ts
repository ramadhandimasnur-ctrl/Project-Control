import 'server-only';

import { and, asc, eq, inArray } from 'drizzle-orm';

import { db } from '@/db';
import { withUser } from '@/db/context';
import { workItemMilestones, workItems } from '@/db/schema';
import { toDecimal, toPercentString } from '@/lib/calc/decimal';
import { progressFromMilestones } from '@/lib/calc/progress';
import { conflict, notFound, validation } from '@/lib/errors';

import { assertProjectAccess } from './access';
import { writeAuditLog } from './audit';
import { type SessionUser } from './session';

/**
 * Stages of a work item measured by milestone.
 *
 * A milestone is completed once for the whole project rather than per period —
 * "pondasi selesai" does not happen again in March — so completion is a date on
 * the milestone, and the period it belongs to is derived from that date.
 *
 * Weights are not forced to add up to 1. A half-specified checklist should
 * report the completion it actually covers rather than be scaled up into a
 * claim nobody made; the service says how far short it falls instead.
 */

export type MilestoneRow = {
  id: string;
  name: string;
  weight: string;
  sortOrder: number;
  completedAt: string | null;
};

export type MilestoneSet = {
  workItemId: string;
  milestones: MilestoneRow[];
  /** Σ of every milestone's weight, complete or not. */
  totalWeight: string;
  /** Σ of the completed ones — the item's cumulative completion. */
  completion: string;
  /** True when the weights do not describe the whole item. */
  isUnderSpecified: boolean;
};

export async function listMilestones(
  userId: string,
  projectId: string,
  workItemId: string,
): Promise<MilestoneSet> {
  await assertProjectAccess(userId, projectId, 'VIEWER');

  const [item] = await db
    .select({ id: workItems.id })
    .from(workItems)
    .where(and(eq(workItems.id, workItemId), eq(workItems.projectId, projectId)))
    .limit(1);

  if (!item) throw notFound('Pekerjaan tidak ditemukan pada proyek ini.');

  const rows = await db
    .select({
      id: workItemMilestones.id,
      name: workItemMilestones.name,
      weight: workItemMilestones.weight,
      sortOrder: workItemMilestones.sortOrder,
      completedAt: workItemMilestones.completedAt,
    })
    .from(workItemMilestones)
    .where(eq(workItemMilestones.workItemId, workItemId))
    .orderBy(asc(workItemMilestones.sortOrder), asc(workItemMilestones.name));

  const totalWeight = rows.reduce((acc, row) => acc.plus(toDecimal(row.weight)), toDecimal(0));
  const completion = progressFromMilestones(
    rows,
    rows.filter((row) => row.completedAt !== null).map((row) => row.id),
  );

  return {
    workItemId,
    milestones: rows,
    totalWeight: totalWeight.toString(),
    completion: completion.toString(),
    isUnderSpecified: rows.length > 0 && totalWeight.lessThan(1),
  };
}

export type MilestoneInput = {
  /** Existing id, or null for a stage being added. */
  id: string | null;
  name: string;
  /** 0..1 fraction of the work item. */
  weight: string;
  sortOrder: number;
  completedAt: string | null;
};

/**
 * Replaces a work item's whole set of stages.
 *
 * Written as one transaction because the stages only mean anything together:
 * a half-applied edit could leave weights summing past 1, which would let an
 * item report more than complete.
 */
export async function saveMilestones(
  user: SessionUser,
  projectId: string,
  workItemId: string,
  input: readonly MilestoneInput[],
): Promise<{ count: number; completion: string }> {
  const access = await assertProjectAccess(user.id, projectId, 'ENGINEER');

  const [item] = await db
    .select({ id: workItems.id, method: workItems.progressMethod })
    .from(workItems)
    .where(and(eq(workItems.id, workItemId), eq(workItems.projectId, projectId)))
    .limit(1);

  if (!item) throw notFound('Pekerjaan tidak ditemukan pada proyek ini.');

  const named = input.filter((row) => row.name.trim() !== '');

  let total = toDecimal(0);
  for (const row of named) {
    const weight = toDecimal(row.weight);
    if (weight.lessThan(0) || weight.greaterThan(1)) {
      throw validation(`Bobot tahapan "${row.name}" harus antara 0% dan 100%.`);
    }
    total = total.plus(weight);
  }

  if (total.greaterThan(1)) {
    throw validation(
      `Jumlah bobot tahapan ${total.times(100).toDecimalPlaces(2)}% melebihi 100%.`,
      'Sebuah pekerjaan tidak dapat lebih dari selesai.',
    );
  }

  return withUser(user.id, async (tx) => {
    const existing = await tx
      .select({ id: workItemMilestones.id })
      .from(workItemMilestones)
      .where(eq(workItemMilestones.workItemId, workItemId));

    const keep = new Set(named.map((row) => row.id).filter((id): id is string => id !== null));
    const doomed = existing.filter((row) => !keep.has(row.id)).map((row) => row.id);

    if (doomed.length > 0) {
      await tx.delete(workItemMilestones).where(inArray(workItemMilestones.id, doomed));
    }

    for (const row of named) {
      const values = {
        name: row.name.trim(),
        weight: toPercentString(row.weight),
        sortOrder: row.sortOrder,
        completedAt: row.completedAt,
        updatedBy: user.id,
      };

      if (row.id === null) {
        await tx
          .insert(workItemMilestones)
          .values({ workItemId, ...values, createdBy: user.id });
      } else {
        await tx
          .update(workItemMilestones)
          .set(values)
          .where(eq(workItemMilestones.id, row.id));
      }
    }

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'work_item_milestones',
      recordId: workItemId,
      action: 'UPDATE',
      after: { stages: named.length, removed: doomed.length },
      actorId: user.id,
    });

    const completion = progressFromMilestones(
      named.map((row, index) => ({ id: row.id ?? String(index), weight: row.weight })),
      named
        .map((row, index) => (row.completedAt !== null ? (row.id ?? String(index)) : null))
        .filter((id): id is string => id !== null),
    );

    return { count: named.length, completion: completion.toString() };
  });
}

/**
 * Saves the stages and records the progress they imply, in that order.
 *
 * The period's figure is the *increment*: everything the milestones now say is
 * done, minus what earlier periods already had approved. Recording the
 * cumulative figure instead would credit the same stage in every period after
 * the one it was finished in.
 */
export async function recordMilestoneProgress(
  user: SessionUser,
  projectId: string,
  workItemId: string,
  periodId: string,
  input: {
    milestones: readonly MilestoneInput[];
    entryDate: string;
    note: string | null;
  },
): Promise<{ pctThisPeriod: string; completion: string }> {
  await saveMilestones(user, projectId, workItemId, input.milestones);

  const completion = toDecimal(await milestoneCompletion(workItemId));

  const { getProgressBoard, saveProgressEntry } = await import('./progress');
  const board = await getProgressBoard(user.id, projectId, periodId);
  const row = board.rows.find((entry) => entry.workItemId === workItemId);
  const before = toDecimal(row?.completedBefore ?? 0);

  // A stage un-ticked after approval cannot claw progress back out of an
  // approved period; the figure floors at zero rather than going negative.
  const increment = completion.minus(before);
  const pctThisPeriod = increment.isNegative() ? toDecimal(0) : increment;

  await saveProgressEntry(user, projectId, workItemId, periodId, {
    method: 'MILESTONE',
    qtyThisPeriod: null,
    pctThisPeriod: pctThisPeriod.toString(),
    entryDate: input.entryDate,
    // A milestone is the location: the stage that was reached names itself.
    location: null,
    note: input.note,
  });

  return { pctThisPeriod: pctThisPeriod.toString(), completion: completion.toString() };
}

/** Completion implied by the stages ticked off, for one work item. */
export async function milestoneCompletion(workItemId: string): Promise<string> {
  const rows = await db
    .select({
      id: workItemMilestones.id,
      weight: workItemMilestones.weight,
      completedAt: workItemMilestones.completedAt,
    })
    .from(workItemMilestones)
    .where(eq(workItemMilestones.workItemId, workItemId));

  if (rows.length === 0) throw conflict('Pekerjaan ini belum punya tahapan.');

  return progressFromMilestones(
    rows,
    rows.filter((row) => row.completedAt !== null).map((row) => row.id),
  ).toString();
}
