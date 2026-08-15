import 'server-only';

import { and, asc, eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import { withUser } from '@/db/context';
import {
  progressEntries,
  projects,
  schedulePeriods,
  workItemChecklists,
  workItems,
} from '@/db/schema';
import { toPercentString, toQuantityString, toDecimal } from '@/lib/calc/decimal';
import {
  type ComparisonPoint,
  type ProgressMethod,
  type ProgressStatus,
  actualSCurve,
  compareCurves,
  completionByItem,
  deriveProgress,
  deviationStatus,
  remainingFor,
} from '@/lib/calc/progress';
import { conflict, forbidden, notFound, validation } from '@/lib/errors';
import { canApproveProgress } from '@/lib/auth/roles';

import { assertProjectAccess } from './access';
import { writeAuditLog } from './audit';
import { getScheduleOverview } from './schedule';
import { type SessionUser } from './session';

export type ProgressStatusValue = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
export type ChecklistResult = 'PASS' | 'FAIL' | 'NA';

/** Only approved rows move the realised curve (charter section 5.4). */
const COUNTS_TOWARD_ACTUAL: ProgressStatusValue = 'APPROVED';

// --- board ------------------------------------------------------------------

export type ProgressBoardRow = {
  workItemId: string;
  code: string;
  name: string;
  unitCode: string;
  volume: string;
  method: ProgressMethod;
  weight: string;
  includeInProgressWeight: boolean;
  /** The entry for the selected period, if one exists. */
  entryId: string | null;
  qtyThisPeriod: string;
  pctThisPeriod: string;
  status: ProgressStatusValue | null;
  note: string | null;
  rejectReason: string | null;
  /** Approved completion from every other period. */
  completedBefore: string;
  /** How much of the item is still available to report. */
  remaining: string;
  checklistVerdict: ChecklistResult | null;
};

export type ProgressBoard = {
  periods: { id: string; seq: number; label: string; startDate: string; endDate: string }[];
  selectedPeriodId: string | null;
  rows: ProgressBoardRow[];
  requireChecklist: boolean;
  canApprove: boolean;
  /** Entries waiting for a decision, across the whole project. */
  pendingCount: number;
};

export async function getProgressBoard(
  userId: string,
  projectId: string,
  periodId?: string,
): Promise<ProgressBoard> {
  const access = await assertProjectAccess(userId, projectId, 'VIEWER');

  const [project] = await db
    .select({ requireChecklist: projects.requireChecklistBeforeApprove })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) throw notFound('Proyek tidak ditemukan.');

  const periods = await db
    .select({
      id: schedulePeriods.id,
      seq: schedulePeriods.seq,
      label: schedulePeriods.label,
      startDate: schedulePeriods.startDate,
      endDate: schedulePeriods.endDate,
    })
    .from(schedulePeriods)
    .where(eq(schedulePeriods.projectId, projectId))
    .orderBy(asc(schedulePeriods.seq));

  const selected = periodId ?? periods[0]?.id ?? null;

  const overview = await getScheduleOverview(userId, projectId);
  const weightOf = new Map(overview.rows.map((row) => [row.workItemId, row.weight]));

  const items = await db
    .select({
      id: workItems.id,
      code: workItems.code,
      name: workItems.name,
      volume: workItems.volume,
      method: workItems.progressMethod,
      includeInProgressWeight: workItems.includeInProgressWeight,
      sortOrder: workItems.sortOrder,
    })
    .from(workItems)
    .where(and(eq(workItems.projectId, projectId), eq(workItems.isActive, true)))
    .orderBy(asc(workItems.sortOrder), asc(workItems.code));

  const unitOf = new Map(overview.rows.map((row) => [row.workItemId, row.unitCode]));

  const entries = await db
    .select({
      id: progressEntries.id,
      workItemId: progressEntries.workItemId,
      periodId: progressEntries.periodId,
      qtyThisPeriod: progressEntries.qtyThisPeriod,
      pctThisPeriod: progressEntries.pctThisPeriod,
      status: progressEntries.status,
      note: progressEntries.note,
      rejectReason: progressEntries.rejectReason,
    })
    .from(progressEntries)
    .where(eq(progressEntries.projectId, projectId));

  const approved = entries.filter((entry) => entry.status === COUNTS_TOWARD_ACTUAL);
  const forPeriod = new Map(
    entries.filter((entry) => entry.periodId === selected).map((entry) => [entry.workItemId, entry]),
  );

  const checklists =
    selected === null
      ? []
      : await db
          .select({
            workItemId: workItemChecklists.workItemId,
            verdict: workItemChecklists.verdict,
          })
          .from(workItemChecklists)
          .where(eq(workItemChecklists.periodId, selected));

  const verdictOf = new Map(checklists.map((row) => [row.workItemId, row.verdict]));

  const completions = completionByItem(
    approved.filter((entry) => entry.periodId !== selected),
    items.map((item) => item.id),
  );
  const completedBefore = new Map(completions.map((c) => [c.workItemId, c.completion]));

  const rows: ProgressBoardRow[] = items.map((item) => {
    const entry = forPeriod.get(item.id);
    const before = completedBefore.get(item.id) ?? toDecimal(0);

    return {
      workItemId: item.id,
      code: item.code,
      name: item.name,
      unitCode: unitOf.get(item.id) ?? '',
      volume: item.volume,
      method: item.method,
      weight: weightOf.get(item.id) ?? '0',
      includeInProgressWeight: item.includeInProgressWeight,
      entryId: entry?.id ?? null,
      qtyThisPeriod: entry?.qtyThisPeriod ?? '0',
      pctThisPeriod: entry?.pctThisPeriod ?? '0',
      status: entry?.status ?? null,
      note: entry?.note ?? null,
      rejectReason: entry?.rejectReason ?? null,
      completedBefore: before.toString(),
      remaining: remainingFor(
        approved.map((e) => ({
          workItemId: e.workItemId,
          periodId: e.periodId,
          pctThisPeriod: e.pctThisPeriod,
        })),
        item.id,
        selected,
      ).toString(),
      checklistVerdict: verdictOf.get(item.id) ?? null,
    };
  });

  return {
    periods,
    selectedPeriodId: selected,
    rows,
    requireChecklist: project.requireChecklist,
    canApprove: canApproveProgress(access.role),
    pendingCount: entries.filter((entry) => entry.status === 'SUBMITTED').length,
  };
}

// --- write ------------------------------------------------------------------

export type ProgressEntryInput = {
  method: ProgressMethod;
  qtyThisPeriod: string | null;
  pctThisPeriod: string | null;
  entryDate: string;
  note: string | null;
};

/**
 * Records what was done, as a draft.
 *
 * The cumulative ceiling is checked against approved periods only. Two drafts
 * can each look reasonable and still overshoot together, so this is early
 * feedback rather than the gate — approval re-checks against whatever is
 * approved by then.
 */
export async function saveProgressEntry(
  user: SessionUser,
  projectId: string,
  workItemId: string,
  periodId: string,
  input: ProgressEntryInput,
): Promise<{ id: string }> {
  const access = await assertProjectAccess(user.id, projectId, 'FIELD_USER');

  const [item] = await db
    .select({ id: workItems.id, volume: workItems.volume, method: workItems.progressMethod })
    .from(workItems)
    .where(and(eq(workItems.id, workItemId), eq(workItems.projectId, projectId)))
    .limit(1);

  if (!item) throw notFound('Pekerjaan tidak ditemukan pada proyek ini.');

  const [period] = await db
    .select({ id: schedulePeriods.id })
    .from(schedulePeriods)
    .where(and(eq(schedulePeriods.id, periodId), eq(schedulePeriods.projectId, projectId)))
    .limit(1);

  if (!period) throw validation('Periode tidak dikenal pada proyek ini.');

  const existing = await currentEntry(workItemId, periodId);
  if (existing && existing.status === 'APPROVED') {
    throw conflict(
      'Progres periode ini sudah disetujui.',
      'Progres yang sudah disetujui tidak dapat diubah; catat koreksinya pada periode berjalan.',
    );
  }

  const derived = deriveProgress(
    {
      method: input.method,
      qtyThisPeriod: input.qtyThisPeriod,
      pctThisPeriod: input.pctThisPeriod,
    },
    item.volume,
  );

  const approved = await approvedEntries(projectId);
  const room = remainingFor(approved, workItemId, periodId);

  if (derived.pctThisPeriod.greaterThan(room)) {
    throw validation(
      `Sisa pekerjaan yang dapat dilaporkan tinggal ${room.times(100).toDecimalPlaces(2)}%.`,
      'Progres kumulatif sebuah pekerjaan tidak dapat melewati 100%.',
    );
  }

  return withUser(user.id, async (tx) => {
    const values = {
      projectId,
      workItemId,
      periodId,
      entryDate: input.entryDate,
      qtyThisPeriod: toQuantityString(derived.qtyThisPeriod),
      pctThisPeriod: toPercentString(derived.pctThisPeriod),
      method: input.method,
      status: 'DRAFT' as const,
      note: input.note,
      // A rejected entry that is edited starts clean rather than carrying the
      // old reason next to new numbers.
      rejectReason: null,
      submittedBy: null,
      submittedAt: null,
      approvedBy: null,
      approvedAt: null,
      createdBy: user.id,
      updatedBy: user.id,
    };

    const [saved] = await tx
      .insert(progressEntries)
      .values(values)
      .onConflictDoUpdate({
        target: [progressEntries.workItemId, progressEntries.periodId],
        set: {
          entryDate: values.entryDate,
          qtyThisPeriod: values.qtyThisPeriod,
          pctThisPeriod: values.pctThisPeriod,
          method: values.method,
          status: values.status,
          note: values.note,
          rejectReason: null,
          submittedBy: null,
          submittedAt: null,
          approvedBy: null,
          approvedAt: null,
          updatedBy: user.id,
        },
      })
      .returning({ id: progressEntries.id });

    if (!saved) throw conflict('Progres gagal disimpan.');

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'progress_entries',
      recordId: saved.id,
      action: existing ? 'UPDATE' : 'INSERT',
      after: { pct: values.pctThisPeriod, qty: values.qtyThisPeriod, status: 'DRAFT' },
      actorId: user.id,
    });

    return { id: saved.id };
  });
}

export async function submitProgressEntry(
  user: SessionUser,
  projectId: string,
  entryId: string,
): Promise<void> {
  const access = await assertProjectAccess(user.id, projectId, 'FIELD_USER');
  const entry = await entryById(projectId, entryId);

  if (entry.status === 'APPROVED') throw conflict('Progres ini sudah disetujui.');
  if (entry.status === 'SUBMITTED') throw conflict('Progres ini sudah diajukan.');

  await withUser(user.id, async (tx) => {
    await tx
      .update(progressEntries)
      .set({
        status: 'SUBMITTED',
        submittedBy: user.id,
        submittedAt: new Date(),
        rejectReason: null,
        updatedBy: user.id,
      })
      .where(eq(progressEntries.id, entryId));

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'progress_entries',
      recordId: entryId,
      action: 'UPDATE',
      before: { status: entry.status },
      after: { status: 'SUBMITTED' },
      actorId: user.id,
    });
  });
}

/**
 * Approves progress, which is what makes it real.
 *
 * Two gates. The cumulative ceiling is re-checked here because several drafts
 * can each be valid alone and overshoot together. The quality checklist is
 * enforced when the project asks for it — approving work that failed its own
 * inspection is exactly the drift this system exists to stop.
 */
export async function approveProgressEntry(
  user: SessionUser,
  projectId: string,
  entryId: string,
): Promise<void> {
  const access = await assertProjectAccess(user.id, projectId, 'FIELD_USER');

  if (!canApproveProgress(access.role)) {
    throw forbidden(
      'Peran Anda tidak berwenang menyetujui progres.',
      'Persetujuan progres berada pada pengawas atau manajer proyek.',
    );
  }

  const entry = await entryById(projectId, entryId);
  if (entry.status === 'APPROVED') throw conflict('Progres ini sudah disetujui.');
  if (entry.status === 'DRAFT') {
    throw conflict('Progres ini masih draf.', 'Ajukan terlebih dahulu sebelum disetujui.');
  }

  const approved = await approvedEntries(projectId);
  const room = remainingFor(approved, entry.workItemId, entry.periodId);

  if (toDecimal(entry.pctThisPeriod).greaterThan(room)) {
    throw conflict(
      `Menyetujui ini membuat progres kumulatif melewati 100%; sisa yang tersedia ${room.times(100).toDecimalPlaces(2)}%.`,
      'Periode lain sudah disetujui sejak progres ini diajukan. Perbaiki angkanya terlebih dahulu.',
    );
  }

  const [project] = await db
    .select({ requireChecklist: projects.requireChecklistBeforeApprove })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (project?.requireChecklist) {
    const [checklist] = await db
      .select({ verdict: workItemChecklists.verdict })
      .from(workItemChecklists)
      .where(
        and(
          eq(workItemChecklists.workItemId, entry.workItemId),
          eq(workItemChecklists.periodId, entry.periodId),
        ),
      )
      .limit(1);

    if (!checklist || checklist.verdict !== 'PASS') {
      throw conflict(
        checklist
          ? 'Checklist mutu periode ini belum lulus.'
          : 'Checklist mutu periode ini belum diisi.',
        'Proyek ini mewajibkan checklist lulus sebelum progres disetujui. Ubah di Info Proyek bila tidak diperlukan.',
      );
    }
  }

  await withUser(user.id, async (tx) => {
    await tx
      .update(progressEntries)
      .set({
        status: 'APPROVED',
        approvedBy: user.id,
        approvedAt: new Date(),
        rejectReason: null,
        updatedBy: user.id,
      })
      .where(eq(progressEntries.id, entryId));

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'progress_entries',
      recordId: entryId,
      action: 'UPDATE',
      before: { status: entry.status },
      after: { status: 'APPROVED', pct: entry.pctThisPeriod },
      actorId: user.id,
    });
  });
}

export async function rejectProgressEntry(
  user: SessionUser,
  projectId: string,
  entryId: string,
  reason: string,
): Promise<void> {
  const access = await assertProjectAccess(user.id, projectId, 'FIELD_USER');

  if (!canApproveProgress(access.role)) {
    throw forbidden('Peran Anda tidak berwenang menolak progres.');
  }

  const trimmed = reason.trim();
  if (trimmed === '') {
    throw validation(
      'Alasan penolakan wajib diisi.',
      'Petugas lapangan perlu tahu apa yang harus diperbaiki.',
    );
  }

  const entry = await entryById(projectId, entryId);
  if (entry.status !== 'SUBMITTED') {
    throw conflict('Hanya progres yang sedang diajukan yang dapat ditolak.');
  }

  await withUser(user.id, async (tx) => {
    await tx
      .update(progressEntries)
      .set({ status: 'REJECTED', rejectReason: trimmed, updatedBy: user.id })
      .where(eq(progressEntries.id, entryId));

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'progress_entries',
      recordId: entryId,
      action: 'UPDATE',
      before: { status: entry.status },
      after: { status: 'REJECTED', reason: trimmed },
      actorId: user.id,
    });
  });
}

// --- checklist --------------------------------------------------------------

export type ChecklistInput = {
  asDrawing: ChecklistResult;
  position: ChecklistResult;
  dimension: ChecklistResult;
  checkedAt: string | null;
  note: string | null;
};

/**
 * Records the quality inspection for a work item in a period.
 *
 * The verdict is not stored: it is a generated column, so no caller can save a
 * PASS over a failed dimension check.
 */
export async function saveChecklist(
  user: SessionUser,
  projectId: string,
  workItemId: string,
  periodId: string,
  input: ChecklistInput,
): Promise<void> {
  const access = await assertProjectAccess(user.id, projectId, 'FIELD_USER');

  const [item] = await db
    .select({ id: workItems.id })
    .from(workItems)
    .where(and(eq(workItems.id, workItemId), eq(workItems.projectId, projectId)))
    .limit(1);

  if (!item) throw notFound('Pekerjaan tidak ditemukan pada proyek ini.');

  await withUser(user.id, async (tx) => {
    await tx
      .insert(workItemChecklists)
      .values({
        workItemId,
        periodId,
        asDrawing: input.asDrawing,
        position: input.position,
        dimension: input.dimension,
        checkedAt: input.checkedAt,
        checkedBy: user.id,
        note: input.note,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .onConflictDoUpdate({
        target: [workItemChecklists.workItemId, workItemChecklists.periodId],
        /*
         * The index is partial — it only covers rows that name a period — and
         * Postgres will not infer a partial index unless the conflict target
         * repeats its predicate.
         */
        targetWhere: sql`${workItemChecklists.periodId} IS NOT NULL`,
        set: {
          asDrawing: input.asDrawing,
          position: input.position,
          dimension: input.dimension,
          checkedAt: input.checkedAt,
          checkedBy: user.id,
          note: input.note,
          updatedBy: user.id,
        },
      });

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'work_item_checklists',
      recordId: workItemId,
      action: 'UPDATE',
      after: { ...input, periodId },
      actorId: user.id,
    });
  });
}

// --- realised curve ---------------------------------------------------------

export type ProgressComparison = {
  points: ComparisonPoint[];
  /** Where the project stands right now, at the last reported period. */
  current: {
    periodLabel: string | null;
    plannedCumulative: string;
    actualCumulative: string;
    deviation: string;
    status: ProgressStatus;
    spi: string | null;
  };
  curveFromBaseline: boolean;
  hasPlan: boolean;
  hasActual: boolean;
};

/**
 * Plan against reality.
 *
 * The plan comes from the active baseline when there is one, because a plan
 * that moves whenever someone edits a cell cannot be deviated from in any
 * meaningful sense.
 */
export async function getProgressComparison(
  userId: string,
  projectId: string,
): Promise<ProgressComparison> {
  await assertProjectAccess(userId, projectId, 'VIEWER');

  const [overview, project] = await Promise.all([
    getScheduleOverview(userId, projectId),
    db
      .select({
        warning: projects.thresholdWarning,
        delayed: projects.thresholdDelayed,
      })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)
      .then((rows) => rows[0]),
  ]);

  if (!project) throw notFound('Proyek tidak ditemukan.');

  const weights = new Map(
    overview.rows
      .filter((row) => row.includeInProgressWeight)
      .map((row) => [row.workItemId, row.weight] as const),
  );

  const approved = await approvedEntries(projectId);

  const seqOf = new Map(overview.periods.map((period) => [period.id, period.seq]));
  const reportedSeqs = approved
    .map((entry) => seqOf.get(entry.periodId))
    .filter((seq): seq is number => seq !== undefined);
  const lastReportedSeq = reportedSeqs.length === 0 ? null : Math.max(...reportedSeqs);

  const actual = actualSCurve(overview.periods, weights, approved);

  const points = compareCurves(
    overview.curve.map((point) => ({
      periodId: point.periodId,
      seq: point.seq,
      label: point.label,
      cumulativePct: point.cumulativePct,
    })),
    actual.map((point) => ({
      periodId: point.periodId,
      cumulativePct: point.cumulativePct,
    })),
    { warning: project.warning, delayed: project.delayed },
    lastReportedSeq,
  );

  const at =
    lastReportedSeq === null
      ? null
      : (points.find((point) => point.seq === lastReportedSeq) ?? null);

  const current = at
    ? {
        periodLabel: at.label,
        plannedCumulative: at.plannedCumulative.toString(),
        actualCumulative: at.actualCumulative.toString(),
        deviation: at.deviation.toString(),
        status: at.status,
        spi: at.spi === null ? null : at.spi.toString(),
      }
    : {
        periodLabel: null,
        plannedCumulative: '0',
        actualCumulative: '0',
        deviation: '0',
        status: deviationStatus('0', '0', {
          warning: project.warning,
          delayed: project.delayed,
        }).status,
        spi: null,
      };

  return {
    points,
    current,
    curveFromBaseline: overview.curveFromBaseline,
    hasPlan: overview.curve.some((point) => !toDecimal(point.cumulativePct).isZero()),
    hasActual: approved.length > 0,
  };
}

// --- helpers ----------------------------------------------------------------

async function approvedEntries(projectId: string) {
  return db
    .select({
      workItemId: progressEntries.workItemId,
      periodId: progressEntries.periodId,
      pctThisPeriod: progressEntries.pctThisPeriod,
    })
    .from(progressEntries)
    .where(
      and(
        eq(progressEntries.projectId, projectId),
        eq(progressEntries.status, COUNTS_TOWARD_ACTUAL),
      ),
    );
}

async function currentEntry(workItemId: string, periodId: string) {
  const [entry] = await db
    .select({ id: progressEntries.id, status: progressEntries.status })
    .from(progressEntries)
    .where(
      and(eq(progressEntries.workItemId, workItemId), eq(progressEntries.periodId, periodId)),
    )
    .limit(1);
  return entry ?? null;
}

async function entryById(projectId: string, entryId: string) {
  const [entry] = await db
    .select({
      id: progressEntries.id,
      workItemId: progressEntries.workItemId,
      periodId: progressEntries.periodId,
      pctThisPeriod: progressEntries.pctThisPeriod,
      status: progressEntries.status,
    })
    .from(progressEntries)
    .where(and(eq(progressEntries.id, entryId), eq(progressEntries.projectId, projectId)))
    .limit(1);

  if (!entry) throw notFound('Catatan progres tidak ditemukan.');
  return entry;
}

/** Bulk approval for a whole period, used by the board's header action. */
export async function approveManyProgressEntries(
  user: SessionUser,
  projectId: string,
  entryIds: readonly string[],
): Promise<{ approved: number; skipped: { id: string; reason: string }[] }> {
  const skipped: { id: string; reason: string }[] = [];
  let approved = 0;

  // Sequential rather than parallel: each approval changes the cumulative room
  // the next one is measured against.
  for (const entryId of entryIds) {
    try {
      await approveProgressEntry(user, projectId, entryId);
      approved += 1;
    } catch (error) {
      skipped.push({
        id: entryId,
        reason: error instanceof Error ? error.message : 'Gagal disetujui.',
      });
    }
  }

  return { approved, skipped };
}

export async function listEntriesForPeriod(
  userId: string,
  projectId: string,
  periodId: string,
): Promise<{ id: string; workItemId: string; status: ProgressStatusValue }[]> {
  await assertProjectAccess(userId, projectId, 'VIEWER');

  return db
    .select({
      id: progressEntries.id,
      workItemId: progressEntries.workItemId,
      status: progressEntries.status,
    })
    .from(progressEntries)
    .where(
      and(eq(progressEntries.projectId, projectId), eq(progressEntries.periodId, periodId)),
    );
}

export async function deleteProgressEntry(
  user: SessionUser,
  projectId: string,
  entryId: string,
): Promise<void> {
  const access = await assertProjectAccess(user.id, projectId, 'ENGINEER');
  const entry = await entryById(projectId, entryId);

  if (entry.status === 'APPROVED') {
    throw conflict(
      'Progres yang sudah disetujui tidak dapat dihapus.',
      'Riwayat persetujuan harus tetap dapat ditelusuri.',
    );
  }

  await withUser(user.id, async (tx) => {
    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'progress_entries',
      recordId: entryId,
      action: 'DELETE',
      before: { status: entry.status, pct: entry.pctThisPeriod },
      actorId: user.id,
    });
    await tx.delete(progressEntries).where(eq(progressEntries.id, entryId));
  });
}

/** Ids of every entry in a period that is waiting for a decision. */
export async function pendingEntryIds(
  userId: string,
  projectId: string,
  periodId: string,
): Promise<string[]> {
  const entries = await listEntriesForPeriod(userId, projectId, periodId);
  return entries.filter((entry) => entry.status === 'SUBMITTED').map((entry) => entry.id);
}
