import 'server-only';

import { and, asc, count, eq, inArray, notInArray } from 'drizzle-orm';
import { cache } from 'react';

import { db } from '@/db';
import { withUser } from '@/db/context';
import {
  baselineDistributions,
  plannedDistributions,
  projects,
  scheduleBaselines,
  schedulePeriods,
  workItemSchedules,
  workItems,
} from '@/db/schema';
import { toPercentString, toDecimal } from '@/lib/calc/decimal';
import {
  type DistributionCheck,
  type GeneratedPeriod,
  type PeriodType,
  type SCurvePoint,
  checkDistributions,
  distributeByDuration,
  durationBetween,
  generatePeriods,
  plannedSCurve,
} from '@/lib/calc/schedule';
import { conflict, notFound, validation } from '@/lib/errors';

import { assertProjectAccess } from './access';
import { getProjectEstimate } from './ahsp';
import { writeAuditLog } from './audit';
import { type SessionUser } from './session';

// --- periods ----------------------------------------------------------------

export type PeriodRow = {
  id: string;
  seq: number;
  periodType: PeriodType;
  startDate: string;
  endDate: string;
  label: string;
  /** Rows in the editable plan that point at this period. */
  distributionCount: number;
};

export async function listPeriods(userId: string, projectId: string): Promise<PeriodRow[]> {
  await assertProjectAccess(userId, projectId, 'VIEWER');

  const usage = db.$with('period_usage').as(
    db
      .select({
        periodId: plannedDistributions.periodId,
        planTotal: count().as('plan_total'),
      })
      .from(plannedDistributions)
      .groupBy(plannedDistributions.periodId),
  );

  const rows = await db
    .with(usage)
    .select({
      id: schedulePeriods.id,
      seq: schedulePeriods.seq,
      periodType: schedulePeriods.periodType,
      startDate: schedulePeriods.startDate,
      endDate: schedulePeriods.endDate,
      label: schedulePeriods.label,
      distributionCount: usage.planTotal,
    })
    .from(schedulePeriods)
    .leftJoin(usage, eq(usage.periodId, schedulePeriods.id))
    .where(eq(schedulePeriods.projectId, projectId))
    .orderBy(asc(schedulePeriods.seq));

  return rows.map((r) => ({ ...r, distributionCount: r.distributionCount ?? 0 }));
}

export type PeriodPlanPreview = {
  periodType: PeriodType;
  generated: GeneratedPeriod[];
  /** Existing periods reused because their seq still exists in the new plan. */
  keptCount: number;
  addedCount: number;
  /** Periods that would disappear, and how much of the plan they carry. */
  removed: { id: string; seq: number; label: string; distributionCount: number }[];
  /** True when removing them would discard part of the editable plan. */
  wouldDiscardPlan: boolean;
};

/**
 * What regenerating the calendar would do, without doing it.
 *
 * Periods are referenced by the plan with ON DELETE RESTRICT, so a shortened
 * project is not a silent rewrite: the user is told which periods go and how
 * many planned cells go with them (charter section 6.5).
 */
export async function previewPeriodPlan(
  userId: string,
  projectId: string,
  periodType?: PeriodType,
): Promise<PeriodPlanPreview> {
  await assertProjectAccess(userId, projectId, 'VIEWER');

  const project = await loadProjectDates(projectId);
  const type = periodType ?? project.periodType;
  const generated = generatePeriods(project.startDate, project.endDate, type);
  const existing = await listPeriods(userId, projectId);

  const removed = existing
    .filter((period) => period.seq > generated.length)
    .map((period) => ({
      id: period.id,
      seq: period.seq,
      label: period.label,
      distributionCount: period.distributionCount,
    }));

  const keptCount = existing.length - removed.length;

  return {
    periodType: type,
    generated,
    keptCount,
    addedCount: Math.max(generated.length - keptCount, 0),
    removed,
    wouldDiscardPlan: removed.some((period) => period.distributionCount > 0),
  };
}

/**
 * Rebuilds the period calendar from the project's own dates.
 *
 * Periods are matched by `seq` and updated in place rather than dropped and
 * recreated: their ids are what the plan and every baseline point at, so
 * recreating them would either fail on the foreign key or quietly orphan the
 * plan. Only trailing periods that a shortened project no longer reaches are
 * deleted, and only when nothing in the plan still needs them.
 */
export async function regeneratePeriods(
  user: SessionUser,
  projectId: string,
  periodType?: PeriodType,
): Promise<{ kept: number; added: number; removed: number; periodType: PeriodType }> {
  const access = await assertProjectAccess(user.id, projectId, 'ENGINEER');

  const project = await loadProjectDates(projectId);
  const type = periodType ?? project.periodType;
  const generated = generatePeriods(project.startDate, project.endDate, type);

  const existing = await db
    .select({ id: schedulePeriods.id, seq: schedulePeriods.seq })
    .from(schedulePeriods)
    .where(eq(schedulePeriods.projectId, projectId));

  const bySeq = new Map(existing.map((period) => [period.seq, period.id]));
  const doomed = existing.filter((period) => period.seq > generated.length);

  if (doomed.length > 0) {
    const [used] = await db
      .select({ value: count() })
      .from(plannedDistributions)
      .where(
        inArray(
          plannedDistributions.periodId,
          doomed.map((period) => period.id),
        ),
      );

    if ((used?.value ?? 0) > 0) {
      throw conflict(
        `Periode proyek memendek, tetapi ${used?.value ?? 0} sel rencana masih mengisi periode yang akan dihapus.`,
        'Kosongkan distribusi pada periode terakhir terlebih dahulu, atau perpanjang tanggal selesai proyek.',
      );
    }
  }

  return withUser(user.id, async (tx) => {
    for (const period of generated) {
      const existingId = bySeq.get(period.seq);

      if (existingId === undefined) {
        await tx.insert(schedulePeriods).values({
          projectId,
          seq: period.seq,
          periodType: type,
          startDate: period.startDate,
          endDate: period.endDate,
          label: period.label,
          createdBy: user.id,
          updatedBy: user.id,
        });
      } else {
        await tx
          .update(schedulePeriods)
          .set({
            periodType: type,
            startDate: period.startDate,
            endDate: period.endDate,
            label: period.label,
            updatedBy: user.id,
          })
          .where(eq(schedulePeriods.id, existingId));
      }
    }

    if (doomed.length > 0) {
      await tx.delete(schedulePeriods).where(
        inArray(
          schedulePeriods.id,
          doomed.map((period) => period.id),
        ),
      );
    }

    if (type !== project.periodType) {
      await tx
        .update(projects)
        .set({ periodType: type, updatedBy: user.id })
        .where(eq(projects.id, projectId));
    }

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'schedule_periods',
      recordId: projectId,
      action: 'UPDATE',
      after: { periodType: type, count: generated.length },
      actorId: user.id,
    });

    const kept = Math.min(existing.length - doomed.length, generated.length);
    return {
      kept,
      added: generated.length - kept,
      removed: doomed.length,
      periodType: type,
    };
  });
}

async function loadProjectDates(projectId: string): Promise<{
  startDate: string;
  endDate: string;
  periodType: PeriodType;
}> {
  const [project] = await db
    .select({
      startDate: projects.startDate,
      endDate: projects.endDate,
      periodType: projects.periodType,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) throw notFound('Proyek tidak ditemukan.');
  return project;
}

// --- work item schedule -----------------------------------------------------

export type WorkItemScheduleInput = {
  plannedStart: string | null;
  plannedFinish: string | null;
  predecessorId: string | null;
  dependencyType: 'FS' | 'SS' | 'FF' | 'SF';
  lagDays: number;
};

export async function saveWorkItemSchedule(
  user: SessionUser,
  projectId: string,
  workItemId: string,
  input: WorkItemScheduleInput,
): Promise<void> {
  const access = await assertProjectAccess(user.id, projectId, 'ENGINEER');

  const [item] = await db
    .select({ id: workItems.id })
    .from(workItems)
    .where(and(eq(workItems.id, workItemId), eq(workItems.projectId, projectId)))
    .limit(1);

  if (!item) throw notFound('Pekerjaan tidak ditemukan pada proyek ini.');

  if (input.plannedStart !== null && input.plannedFinish !== null) {
    if (durationBetween(input.plannedStart, input.plannedFinish) < 1) {
      throw validation('Tanggal selesai mendahului tanggal mulai.');
    }
  }

  if (input.predecessorId !== null) {
    await assertUsablePredecessor(projectId, workItemId, input.predecessorId);
  }

  const durationDays =
    input.plannedStart !== null && input.plannedFinish !== null
      ? durationBetween(input.plannedStart, input.plannedFinish)
      : null;

  await withUser(user.id, async (tx) => {
    await tx
      .insert(workItemSchedules)
      .values({
        workItemId,
        plannedStart: input.plannedStart,
        plannedFinish: input.plannedFinish,
        durationDays,
        predecessorId: input.predecessorId,
        dependencyType: input.dependencyType,
        lagDays: input.lagDays,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .onConflictDoUpdate({
        target: workItemSchedules.workItemId,
        set: {
          plannedStart: input.plannedStart,
          plannedFinish: input.plannedFinish,
          durationDays,
          predecessorId: input.predecessorId,
          dependencyType: input.dependencyType,
          lagDays: input.lagDays,
          updatedBy: user.id,
        },
      });

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'work_item_schedules',
      recordId: workItemId,
      action: 'UPDATE',
      after: { ...input, durationDays },
      actorId: user.id,
    });
  });
}

/**
 * Rejects a predecessor that belongs to another project or closes a loop.
 *
 * The database already refuses an item that depends on itself, but a chain
 * A â†’ B â†’ A passes every row-level check and only reveals itself when the
 * Gantt tries to walk it.
 */
async function assertUsablePredecessor(
  projectId: string,
  workItemId: string,
  predecessorId: string,
): Promise<void> {
  if (predecessorId === workItemId) {
    throw validation('Pekerjaan tidak dapat menjadi pendahulunya sendiri.');
  }

  const [predecessor] = await db
    .select({ id: workItems.id })
    .from(workItems)
    .where(and(eq(workItems.id, predecessorId), eq(workItems.projectId, projectId)))
    .limit(1);

  if (!predecessor) throw validation('Pekerjaan pendahulu tidak ada pada proyek ini.');

  const edges = await db
    .select({
      workItemId: workItemSchedules.workItemId,
      predecessorId: workItemSchedules.predecessorId,
    })
    .from(workItemSchedules)
    .innerJoin(workItems, eq(workItems.id, workItemSchedules.workItemId))
    .where(eq(workItems.projectId, projectId));

  const parentOf = new Map<string, string | null>(
    edges.map((edge) => [edge.workItemId, edge.predecessorId]),
  );
  // The edge being proposed, not yet stored.
  parentOf.set(workItemId, predecessorId);

  const seen = new Set<string>();
  let cursor: string | null = workItemId;

  while (cursor !== null) {
    if (seen.has(cursor)) {
      throw validation(
        'Ketergantungan ini membentuk lingkaran.',
        'Pekerjaan pendahulu pada akhirnya bergantung kembali pada pekerjaan ini.',
      );
    }
    seen.add(cursor);
    cursor = parentOf.get(cursor) ?? null;
  }
}

// --- planned distribution ---------------------------------------------------

export type DistributionInput = { periodId: string; plannedPct: string };

export type DistributionRowSet = { workItemId: string; cells: readonly DistributionInput[] };

/** Replaces one work item's row in the distribution matrix. */
export async function savePlannedDistribution(
  user: SessionUser,
  projectId: string,
  workItemId: string,
  rows: readonly DistributionInput[],
): Promise<void> {
  await savePlannedDistributions(user, projectId, [{ workItemId, cells: rows }]);
}

/**
 * Replaces whole rows of the distribution matrix, all in one transaction.
 *
 * Saving is by row rather than by cell because a half-written row sits at
 * `Σ ≠ 1`, which is exactly the state that blocks a baseline. Saving several
 * rows at once goes further: the user edits the matrix as one document, so
 * either the whole edit lands or none of it does.
 *
 * Cells at zero are deleted rather than stored, keeping the matrix sparse.
 */
export async function savePlannedDistributions(
  user: SessionUser,
  projectId: string,
  sets: readonly DistributionRowSet[],
): Promise<{ rows: number; cells: number }> {
  const access = await assertProjectAccess(user.id, projectId, 'ENGINEER');

  if (sets.length === 0) return { rows: 0, cells: 0 };

  const workItemIds = [...new Set(sets.map((set) => set.workItemId))];

  const items = await db
    .select({ id: workItems.id })
    .from(workItems)
    .where(and(inArray(workItems.id, workItemIds), eq(workItems.projectId, projectId)));

  if (items.length !== workItemIds.length) {
    throw notFound('Ada pekerjaan yang tidak ditemukan pada proyek ini.');
  }

  const periods = await db
    .select({ id: schedulePeriods.id })
    .from(schedulePeriods)
    .where(eq(schedulePeriods.projectId, projectId));

  /*
   * Everything is checked before anything is written. A rejection part way
   * through would leave some rows saved and others not — the inconsistency
   * this function exists to prevent.
   */
  const known = new Set(periods.map((period) => period.id));
  for (const set of sets) {
    for (const row of set.cells) {
      if (!known.has(row.periodId)) {
        throw validation('Ada periode yang bukan milik proyek ini.');
      }
      const value = toDecimal(row.plannedPct);
      if (value.lessThan(0) || value.greaterThan(1)) {
        throw validation('Porsi periode harus antara 0% dan 100%.');
      }
    }
  }

  const prepared = sets.map((set) => ({
    workItemId: set.workItemId,
    meaningful: set.cells.filter((row) => !toDecimal(row.plannedPct).isZero()),
  }));

  return withUser(user.id, async (tx) => {
    await tx
      .delete(plannedDistributions)
      .where(inArray(plannedDistributions.workItemId, workItemIds));

    const values = prepared.flatMap((set) =>
      set.meaningful.map((row) => ({
        workItemId: set.workItemId,
        periodId: row.periodId,
        plannedPct: toPercentString(row.plannedPct),
        createdBy: user.id,
        updatedBy: user.id,
      })),
    );

    if (values.length > 0) {
      await tx.insert(plannedDistributions).values(values);
    }

    for (const set of prepared) {
      await writeAuditLog(tx, {
        orgId: access.orgId,
        projectId,
        tableName: 'planned_distributions',
        recordId: set.workItemId,
        action: 'UPDATE',
        after: { cells: set.meaningful.length },
        actorId: user.id,
      });
    }

    return { rows: prepared.length, cells: values.length };
  });
}

/**
 * Spreads a work item evenly across the periods its planned dates cover.
 *
 * A straight line is a starting point, not a claim about how the work will
 * actually run; the user reshapes the cells afterwards.
 */
export async function autoDistributeWorkItem(
  user: SessionUser,
  projectId: string,
  workItemId: string,
): Promise<{ cells: number }> {
  await assertProjectAccess(user.id, projectId, 'ENGINEER');

  const [schedule] = await db
    .select({
      plannedStart: workItemSchedules.plannedStart,
      plannedFinish: workItemSchedules.plannedFinish,
    })
    .from(workItemSchedules)
    .where(eq(workItemSchedules.workItemId, workItemId))
    .limit(1);

  if (!schedule?.plannedStart || !schedule.plannedFinish) {
    throw validation(
      'Pekerjaan ini belum punya tanggal rencana.',
      'Isi tanggal mulai dan selesai terlebih dahulu, lalu sebar otomatis.',
    );
  }

  const periods = await db
    .select({
      id: schedulePeriods.id,
      startDate: schedulePeriods.startDate,
      endDate: schedulePeriods.endDate,
    })
    .from(schedulePeriods)
    .where(eq(schedulePeriods.projectId, projectId))
    .orderBy(asc(schedulePeriods.seq));

  if (periods.length === 0) {
    throw validation(
      'Proyek ini belum memiliki periode.',
      'Bangun kalender periode terlebih dahulu.',
    );
  }

  const distribution = distributeByDuration(periods, schedule.plannedStart, schedule.plannedFinish);

  if (distribution.length === 0) {
    throw validation(
      'Tanggal rencana pekerjaan ini berada di luar rentang proyek.',
      'Sesuaikan tanggalnya, atau perbarui tanggal proyek lalu bangun ulang periodenya.',
    );
  }

  await savePlannedDistribution(
    user,
    projectId,
    workItemId,
    distribution.map((row) => ({
      periodId: row.periodId,
      plannedPct: row.plannedPct.toString(),
    })),
  );

  return { cells: distribution.length };
}

// --- overview ---------------------------------------------------------------

export type GanttRow = {
  workItemId: string;
  code: string;
  name: string;
  groupName: string | null;
  unitCode: string;
  weight: string;
  includeInProgressWeight: boolean;
  plannedStart: string | null;
  plannedFinish: string | null;
  durationDays: number | null;
  predecessorId: string | null;
  predecessorCode: string | null;
  dependencyType: 'FS' | 'SS' | 'FF' | 'SF';
  lagDays: number;
  /** Σ of this item's row in the matrix, and whether it equals 1. */
  distributionTotal: string;
  distributionComplete: boolean;
};

export type ScheduleOverview = {
  projectStart: string;
  projectEnd: string;
  periodType: PeriodType;
  periods: PeriodRow[];
  rows: GanttRow[];
  /** workItemId â†’ periodId â†’ planned share, only the non-zero cells. */
  matrix: Record<string, Record<string, string>>;
  /**
   * The plan progress is actually measured against: the active baseline when
   * there is one, otherwise the draft.
   *
   * Distinct from `matrix`, which is always the editable draft because that is
   * what the distribution editor writes back. Deviation read from `matrix`
   * would move whenever someone opened the editor.
   */
  effectivePlan: { workItemId: string; periodId: string; plannedPct: string }[];
  curve: { periodId: string; seq: number; label: string; plannedPct: string; cumulativePct: string }[];
  /** True when the curve comes from a frozen baseline rather than the draft. */
  curveFromBaseline: boolean;
  activeBaseline: { id: string; name: string; baselinedAt: string } | null;
  /** Weighted items whose row does not sum to 1; a baseline cannot be taken. */
  incomplete: DistributionCheck[];
  showCosts: boolean;
};

/**
 * Memoised for the lifetime of one request.
 *
 * Assembling this runs the whole project estimate, and a page that shows both
 * the schedule and the progress comparison reaches for it down two independent
 * paths. Without the cache a report page prices every work item twice to draw
 * one sheet of paper.
 */
export const getScheduleOverview = cache(async function getScheduleOverview(
  userId: string,
  projectId: string,
): Promise<ScheduleOverview> {
  await assertProjectAccess(userId, projectId, 'VIEWER');

  const project = await loadProjectDates(projectId);
  const [periods, estimate, baseline] = await Promise.all([
    listPeriods(userId, projectId),
    getProjectEstimate(userId, projectId),
    getActiveBaseline(projectId),
  ]);

  const itemIds = estimate.items.map((item) => item.workItemId);

  const [schedules, planned, baselineRows] = await Promise.all([
    itemIds.length === 0
      ? []
      : db
          .select({
            workItemId: workItemSchedules.workItemId,
            plannedStart: workItemSchedules.plannedStart,
            plannedFinish: workItemSchedules.plannedFinish,
            durationDays: workItemSchedules.durationDays,
            predecessorId: workItemSchedules.predecessorId,
            dependencyType: workItemSchedules.dependencyType,
            lagDays: workItemSchedules.lagDays,
          })
          .from(workItemSchedules)
          .where(inArray(workItemSchedules.workItemId, itemIds)),
    itemIds.length === 0
      ? []
      : db
          .select({
            workItemId: plannedDistributions.workItemId,
            periodId: plannedDistributions.periodId,
            plannedPct: plannedDistributions.plannedPct,
          })
          .from(plannedDistributions)
          .where(inArray(plannedDistributions.workItemId, itemIds)),
    baseline === null
      ? []
      : db
          .select({
            workItemId: baselineDistributions.workItemId,
            periodId: baselineDistributions.periodId,
            plannedPct: baselineDistributions.plannedPct,
          })
          .from(baselineDistributions)
          .where(eq(baselineDistributions.baselineId, baseline.id)),
  ]);

  const scheduleOf = new Map(schedules.map((row) => [row.workItemId, row]));
  const codeOf = new Map(estimate.items.map((item) => [item.workItemId, item.code]));

  const weightedIds = estimate.items
    .filter((item) => item.includeInProgressWeight)
    .map((item) => item.workItemId);

  const checks = checkDistributions(planned, weightedIds);
  const checkOf = new Map(checks.map((check) => [check.workItemId, check]));

  const matrix: Record<string, Record<string, string>> = {};
  for (const row of planned) {
    (matrix[row.workItemId] ??= {})[row.periodId] = row.plannedPct;
  }

  const rows: GanttRow[] = estimate.items.map((item) => {
    const schedule = scheduleOf.get(item.workItemId);
    const check = checkOf.get(item.workItemId);

    return {
      workItemId: item.workItemId,
      code: item.code,
      name: item.name,
      groupName: item.groupName,
      unitCode: item.unitCode,
      weight: item.weight,
      includeInProgressWeight: item.includeInProgressWeight,
      plannedStart: schedule?.plannedStart ?? null,
      plannedFinish: schedule?.plannedFinish ?? null,
      durationDays: schedule?.durationDays ?? null,
      predecessorId: schedule?.predecessorId ?? null,
      predecessorCode:
        schedule?.predecessorId === undefined || schedule.predecessorId === null
          ? null
          : (codeOf.get(schedule.predecessorId) ?? null),
      dependencyType: schedule?.dependencyType ?? 'FS',
      lagDays: schedule?.lagDays ?? 0,
      distributionTotal: (check?.total ?? toDecimal(0)).toString(),
      distributionComplete: check?.isComplete ?? false,
    };
  });

  const weights = new Map(
    estimate.items
      .filter((item) => item.includeInProgressWeight)
      .map((item) => [item.workItemId, item.weight] as const),
  );

  const source = baseline === null ? planned : baselineRows;
  const curve = sCurveOf(periods, weights, source);

  return {
    projectStart: project.startDate,
    projectEnd: project.endDate,
    periodType: project.periodType,
    periods,
    rows,
    matrix,
    effectivePlan: source,
    curve,
    curveFromBaseline: baseline !== null,
    activeBaseline: baseline,
    incomplete: checks.filter((check) => !check.isComplete),
    showCosts: estimate.showCosts,
  };
});

function sCurveOf(
  periods: readonly PeriodRow[],
  weights: ReadonlyMap<string, string>,
  distributions: readonly { workItemId: string; periodId: string; plannedPct: string }[],
): ScheduleOverview['curve'] {
  const points: SCurvePoint[] = plannedSCurve(periods, weights, distributions);
  return points.map((point) => ({
    periodId: point.periodId,
    seq: point.seq,
    label: point.label,
    plannedPct: point.plannedPct.toString(),
    cumulativePct: point.cumulativePct.toString(),
  }));
}

// --- baseline ---------------------------------------------------------------

export type BaselineRow = {
  id: string;
  name: string;
  baselinedAt: string;
  isActive: boolean;
  cellCount: number;
};

async function getActiveBaseline(
  projectId: string,
): Promise<{ id: string; name: string; baselinedAt: string } | null> {
  const [row] = await db
    .select({
      id: scheduleBaselines.id,
      name: scheduleBaselines.name,
      baselinedAt: scheduleBaselines.baselinedAt,
    })
    .from(scheduleBaselines)
    .where(and(eq(scheduleBaselines.projectId, projectId), eq(scheduleBaselines.isActive, true)))
    .limit(1);

  return row ? { ...row, baselinedAt: row.baselinedAt.toISOString() } : null;
}

export async function listBaselines(userId: string, projectId: string): Promise<BaselineRow[]> {
  await assertProjectAccess(userId, projectId, 'VIEWER');

  const cells = db.$with('baseline_cells').as(
    db
      .select({
        baselineId: baselineDistributions.baselineId,
        cellTotal: count().as('cell_total'),
      })
      .from(baselineDistributions)
      .groupBy(baselineDistributions.baselineId),
  );

  const rows = await db
    .with(cells)
    .select({
      id: scheduleBaselines.id,
      name: scheduleBaselines.name,
      baselinedAt: scheduleBaselines.baselinedAt,
      isActive: scheduleBaselines.isActive,
      cellCount: cells.cellTotal,
    })
    .from(scheduleBaselines)
    .leftJoin(cells, eq(cells.baselineId, scheduleBaselines.id))
    .where(eq(scheduleBaselines.projectId, projectId))
    .orderBy(asc(scheduleBaselines.baselinedAt));

  return rows.map((r) => ({
    ...r,
    baselinedAt: r.baselinedAt.toISOString(),
    cellCount: r.cellCount ?? 0,
  }));
}

/**
 * Freezes the current plan.
 *
 * Design decision 12: the planned S-curve reads from the baseline, so the copy
 * has to be complete and taken in one transaction. A plan where some weighted
 * item does not sum to 1 is refused outright — a baseline that starts from a
 * broken plan produces a curve that never reaches 100% and no one can tell why.
 */
export async function createBaseline(
  user: SessionUser,
  projectId: string,
  name: string,
): Promise<{ id: string; cells: number }> {
  const access = await assertProjectAccess(user.id, projectId, 'PROJECT_MANAGER');

  const trimmed = name.trim();
  if (trimmed === '') throw validation('Nama baseline wajib diisi.');

  const estimate = await getProjectEstimate(user.id, projectId);
  const weightedIds = estimate.items
    .filter((item) => item.includeInProgressWeight)
    .map((item) => item.workItemId);

  if (weightedIds.length === 0) {
    throw validation(
      'Belum ada pekerjaan yang membawa bobot progres.',
      'Susun daftar pekerjaan dan analisanya terlebih dahulu.',
    );
  }

  const planned = await db
    .select({
      workItemId: plannedDistributions.workItemId,
      periodId: plannedDistributions.periodId,
      plannedPct: plannedDistributions.plannedPct,
    })
    .from(plannedDistributions)
    .where(inArray(plannedDistributions.workItemId, weightedIds));

  const incomplete = checkDistributions(planned, weightedIds).filter((check) => !check.isComplete);

  if (incomplete.length > 0) {
    const codeOf = new Map(estimate.items.map((item) => [item.workItemId, item.code]));
    const names = incomplete
      .slice(0, 5)
      .map((check) => codeOf.get(check.workItemId) ?? check.workItemId)
      .join(', ');
    const more = incomplete.length > 5 ? `, dan ${incomplete.length - 5} lainnya` : '';

    throw conflict(
      `${incomplete.length} pekerjaan belum terdistribusi penuh: ${names}${more}.`,
      'Setiap pekerjaan berbobot harus tersebar tepat 100% di seluruh periode sebelum baseline dikunci.',
    );
  }

  return withUser(user.id, async (tx) => {
    // Exactly one active baseline per project; the partial unique index would
    // otherwise reject the insert.
    await tx
      .update(scheduleBaselines)
      .set({ isActive: false, updatedBy: user.id })
      .where(eq(scheduleBaselines.projectId, projectId));

    const [created] = await tx
      .insert(scheduleBaselines)
      .values({
        projectId,
        name: trimmed,
        baselinedBy: user.id,
        isActive: true,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning({ id: scheduleBaselines.id });

    if (!created) throw conflict('Baseline gagal dibuat.');

    if (planned.length > 0) {
      await tx.insert(baselineDistributions).values(
        planned.map((row) => ({
          baselineId: created.id,
          workItemId: row.workItemId,
          periodId: row.periodId,
          plannedPct: row.plannedPct,
        })),
      );
    }

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'schedule_baselines',
      recordId: created.id,
      action: 'INSERT',
      after: { name: trimmed, cells: planned.length },
      actorId: user.id,
    });

    return { id: created.id, cells: planned.length };
  });
}

/** Switches which frozen plan the planned S-curve is read from. */
export async function activateBaseline(
  user: SessionUser,
  projectId: string,
  baselineId: string,
): Promise<void> {
  const access = await assertProjectAccess(user.id, projectId, 'PROJECT_MANAGER');

  const [baseline] = await db
    .select({ id: scheduleBaselines.id, name: scheduleBaselines.name })
    .from(scheduleBaselines)
    .where(and(eq(scheduleBaselines.id, baselineId), eq(scheduleBaselines.projectId, projectId)))
    .limit(1);

  if (!baseline) throw notFound('Baseline tidak ditemukan.');

  await withUser(user.id, async (tx) => {
    await tx
      .update(scheduleBaselines)
      .set({ isActive: false, updatedBy: user.id })
      .where(
        and(eq(scheduleBaselines.projectId, projectId), notInArray(scheduleBaselines.id, [baselineId])),
      );

    await tx
      .update(scheduleBaselines)
      .set({ isActive: true, updatedBy: user.id })
      .where(eq(scheduleBaselines.id, baselineId));

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'schedule_baselines',
      recordId: baselineId,
      action: 'UPDATE',
      after: { isActive: true },
      actorId: user.id,
    });
  });
}
