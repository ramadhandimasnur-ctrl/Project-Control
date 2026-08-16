import 'server-only';

import { and, eq } from 'drizzle-orm';

import { db } from '@/db';
import { progressEntries } from '@/db/schema';
import { toDecimal } from '@/lib/calc/decimal';
import { completionByItem } from '@/lib/calc/progress';
import { type SimulationCandidate } from '@/lib/calc/capital';

import { assertProjectAccess } from './access';
import { getProjectEstimate } from './ahsp';
import { getScheduleOverview } from './schedule';

/**
 * The work between today's progress and a target, ready to be simulated.
 *
 * Shared by the two questions that ask it: how much cash a progress target
 * needs, and what material it consumes. Both walk the same work items in the
 * same plan order, and deriving that twice would eventually give a purchasing
 * list that disagrees with the budget it was drawn against.
 */

/** Sorts last: an unscheduled item is the least certain thing to promise. */
const UNSCHEDULED = Number.MAX_SAFE_INTEGER;

export async function getSimulationCandidates(
  userId: string,
  projectId: string,
): Promise<SimulationCandidate[]> {
  await assertProjectAccess(userId, projectId, 'VIEWER');

  const [estimate, overview] = await Promise.all([
    getProjectEstimate(userId, projectId),
    getScheduleOverview(userId, projectId),
  ]);

  const approved = await db
    .select({
      workItemId: progressEntries.workItemId,
      periodId: progressEntries.periodId,
      pctThisPeriod: progressEntries.pctThisPeriod,
    })
    .from(progressEntries)
    .where(and(eq(progressEntries.projectId, projectId), eq(progressEntries.status, 'APPROVED')));

  const completion = new Map(
    completionByItem(
      approved,
      estimate.items.map((item) => item.workItemId),
    ).map((row) => [row.workItemId, row.completion]),
  );

  // Plan order: the first period each item is scheduled to be worked in.
  const seqOf = new Map(overview.periods.map((period) => [period.id, period.seq]));
  const firstPeriod = new Map<string, number>();
  for (const cell of overview.effectivePlan) {
    const seq = seqOf.get(cell.periodId);
    if (seq === undefined) continue;
    const current = firstPeriod.get(cell.workItemId);
    if (current === undefined || seq < current) firstPeriod.set(cell.workItemId, seq);
  }

  return estimate.items.map((item) => ({
    workItemId: item.workItemId,
    code: item.code,
    name: item.name,
    weight: item.includeInProgressWeight ? item.weight : '0',
    totalRab: item.totalRab,
    totalRap: item.totalRap,
    completed: (completion.get(item.workItemId) ?? toDecimal(0)).toString(),
    order: firstPeriod.get(item.workItemId) ?? UNSCHEDULED,
  }));
}
