import 'server-only';

import { and, asc, desc, eq } from 'drizzle-orm';

import { db } from '@/db';
import { withUser } from '@/db/context';
import { issues, projects, reportSnapshots, schedulePeriods } from '@/db/schema';
import { toDecimal } from '@/lib/calc/decimal';
import { type ProgressStatus } from '@/lib/calc/progress';
import { conflict, notFound, validation } from '@/lib/errors';
import type { IssueSeverity, IssueStatus, ReportType } from '@/lib/reports/labels';

import { assertProjectAccess } from './access';
import { writeAuditLog } from './audit';
import { getProgressBoard, getProgressComparison } from './progress';
import { type SessionUser } from './session';

// Vocabulary lives in lib/reports/labels so client components can read it
// without importing this server-only module.
export type { IssueSeverity, IssueStatus, ReportType } from '@/lib/reports/labels';

/**
 * Everything a published report says, as it said it.
 *
 * Written into the snapshot verbatim. Charter section 4.9 calls this one of
 * only two intentional stores of derived values, and the reason is the whole
 * point of publishing: a report handed to an owner in March must still show
 * March's figures in June, even after a correction has moved them.
 */
export type ReportPayload = {
  version: 1;
  project: {
    code: string;
    name: string;
    location: string | null;
    contractValue: string;
  };
  period: { id: string; seq: number; label: string; startDate: string; endDate: string };
  physical: {
    plannedCumulative: string;
    actualCumulative: string;
    deviation: string;
    status: ProgressStatus;
    spi: string | null;
    fromBaseline: boolean;
  };
  items: {
    code: string;
    name: string;
    unitCode: string;
    weight: string;
    completedBefore: string;
    pctThisPeriod: string;
    status: string | null;
  }[];
  /**
   * Planned against realised, period by period — weekly and monthly only.
   *
   * A daily sheet covers one day and a curve across it says nothing; the
   * shape only becomes readable over weeks.
   */
  curve:
    | {
        label: string;
        plannedCumulative: string;
        actualCumulative: string;
        deviation: string;
      }[]
    | null;
  issues: {
    title: string;
    description: string | null;
    severity: IssueSeverity;
    status: IssueStatus;
  }[];
};

/**
 * Computes what a report would say right now, without storing it.
 *
 * Feeds both the preview and the publish step, so what the user approves on
 * screen is exactly what gets frozen.
 *
 * No internal cost figure appears here — not RAP, not realised cost, not
 * margin. A published report is what goes to the owner with the invoice, and
 * RAP is the contractor's own execution budget: printing it hands over the
 * cost structure and the margin on it. Those figures live on the Dashboard and
 * Kebutuhan Modal, which are closed to roles that must not see costs.
 */
export async function buildReportPayload(
  userId: string,
  projectId: string,
  periodId: string,
  reportType: ReportType,
): Promise<ReportPayload> {
  await assertProjectAccess(userId, projectId, 'VIEWER');

  const [project] = await db
    .select({
      code: projects.code,
      name: projects.name,
      location: projects.location,
      contractValue: projects.contractValue,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) throw notFound('Proyek tidak ditemukan.');

  const [period] = await db
    .select({
      id: schedulePeriods.id,
      seq: schedulePeriods.seq,
      label: schedulePeriods.label,
      startDate: schedulePeriods.startDate,
      endDate: schedulePeriods.endDate,
    })
    .from(schedulePeriods)
    .where(and(eq(schedulePeriods.id, periodId), eq(schedulePeriods.projectId, projectId)))
    .limit(1);

  if (!period) throw validation('Periode tidak dikenal pada proyek ini.');

  const [board, comparison, periodIssues] = await Promise.all([
    getProgressBoard(userId, projectId, periodId),
    getProgressComparison(userId, projectId),
    listIssues(userId, projectId, periodId),
  ]);

  const atPeriod = comparison.points.find((point) => point.periodId === periodId) ?? null;

  /*
   * The curve runs up to the reporting period and stops. Drawing the plan for
   * months that have not happened yet next to an empty realised line makes a
   * project look catastrophically behind on the day it is issued.
   */
  const curve =
    reportType === 'DAILY'
      ? null
      : comparison.points
          .filter((point) => point.seq <= period.seq)
          .map((point) => ({
            label: point.label,
            plannedCumulative: point.plannedCumulative.toString(),
            actualCumulative: point.actualCumulative.toString(),
            deviation: point.deviation.toString(),
          }));

  return {
    version: 1,
    project,
    period,
    physical: {
      plannedCumulative: (atPeriod?.plannedCumulative ?? toDecimal(0)).toString(),
      actualCumulative: (atPeriod?.actualCumulative ?? toDecimal(0)).toString(),
      deviation: (atPeriod?.deviation ?? toDecimal(0)).toString(),
      status: atPeriod?.status ?? comparison.current.status,
      spi: atPeriod?.spi === null || atPeriod === null ? null : atPeriod.spi.toString(),
      fromBaseline: comparison.curveFromBaseline,
    },
    items: board.rows
      .filter((row) => row.status !== null)
      .map((row) => ({
        code: row.code,
        name: row.name,
        unitCode: row.unitCode,
        weight: row.weight,
        completedBefore: row.completedBefore,
        pctThisPeriod: row.pctThisPeriod,
        status: row.status,
      })),
    curve,
    issues: periodIssues.map((issue) => ({
      title: issue.title,
      description: issue.description,
      severity: issue.severity,
      status: issue.status,
    })),
  };
}

export type SnapshotRow = {
  id: string;
  reportType: ReportType;
  periodLabel: string;
  generatedAt: string;
  generatedByName: string | null;
};

export async function listSnapshots(
  userId: string,
  projectId: string,
): Promise<SnapshotRow[]> {
  await assertProjectAccess(userId, projectId, 'VIEWER');

  const rows = await db
    .select({
      id: reportSnapshots.id,
      reportType: reportSnapshots.reportType,
      periodLabel: schedulePeriods.label,
      generatedAt: reportSnapshots.generatedAt,
    })
    .from(reportSnapshots)
    .innerJoin(schedulePeriods, eq(schedulePeriods.id, reportSnapshots.periodId))
    .where(eq(reportSnapshots.projectId, projectId))
    .orderBy(desc(reportSnapshots.generatedAt));

  return rows.map((row) => ({
    ...row,
    generatedAt: row.generatedAt.toISOString(),
    generatedByName: null,
  }));
}

/**
 * Reads a published report back.
 *
 * Returns the stored payload untouched. Recomputing here would defeat the
 * reason the snapshot exists.
 */
export async function getSnapshot(
  userId: string,
  projectId: string,
  snapshotId: string,
): Promise<{ id: string; reportType: ReportType; generatedAt: string; payload: ReportPayload }> {
  await assertProjectAccess(userId, projectId, 'VIEWER');

  const [row] = await db
    .select({
      id: reportSnapshots.id,
      reportType: reportSnapshots.reportType,
      generatedAt: reportSnapshots.generatedAt,
      payload: reportSnapshots.payload,
    })
    .from(reportSnapshots)
    .where(and(eq(reportSnapshots.id, snapshotId), eq(reportSnapshots.projectId, projectId)))
    .limit(1);

  if (!row) throw notFound('Laporan tidak ditemukan.');

  return {
    id: row.id,
    reportType: row.reportType,
    generatedAt: row.generatedAt.toISOString(),
    payload: row.payload as ReportPayload,
  };
}

/** Freezes the current figures as a published report. */
export async function publishReport(
  user: SessionUser,
  projectId: string,
  periodId: string,
  reportType: ReportType,
): Promise<{ id: string }> {
  const access = await assertProjectAccess(user.id, projectId, 'ENGINEER');

  const payload = await buildReportPayload(user.id, projectId, periodId, reportType);

  return withUser(user.id, async (tx) => {
    const [created] = await tx
      .insert(reportSnapshots)
      .values({
        projectId,
        periodId,
        reportType,
        payload,
        generatedBy: user.id,
      })
      .returning({ id: reportSnapshots.id });

    if (!created) throw conflict('Laporan gagal diterbitkan.');

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'report_snapshots',
      recordId: created.id,
      action: 'INSERT',
      after: { reportType, periodId },
      actorId: user.id,
    });

    return { id: created.id };
  });
}

// --- issues -----------------------------------------------------------------

export type IssueRow = {
  id: string;
  title: string;
  description: string | null;
  severity: IssueSeverity;
  status: IssueStatus;
  periodId: string | null;
};

export async function listIssues(
  userId: string,
  projectId: string,
  periodId?: string,
): Promise<IssueRow[]> {
  await assertProjectAccess(userId, projectId, 'VIEWER');

  return db
    .select({
      id: issues.id,
      title: issues.title,
      description: issues.description,
      severity: issues.severity,
      status: issues.status,
      periodId: issues.periodId,
    })
    .from(issues)
    .where(
      periodId === undefined
        ? eq(issues.projectId, projectId)
        : and(eq(issues.projectId, projectId), eq(issues.periodId, periodId)),
    )
    .orderBy(asc(issues.status), desc(issues.createdAt));
}

export async function saveIssue(
  user: SessionUser,
  projectId: string,
  issueId: string | null,
  input: {
    title: string;
    description: string | null;
    severity: IssueSeverity;
    status: IssueStatus;
    periodId: string | null;
  },
): Promise<{ id: string }> {
  const access = await assertProjectAccess(user.id, projectId, 'FIELD_USER');

  const title = input.title.trim();
  if (title === '') throw validation('Judul kendala wajib diisi.');

  return withUser(user.id, async (tx) => {
    let id = issueId;

    if (id === null) {
      const [created] = await tx
        .insert(issues)
        .values({
          projectId,
          title,
          description: input.description,
          severity: input.severity,
          status: input.status,
          periodId: input.periodId,
          createdBy: user.id,
          updatedBy: user.id,
        })
        .returning({ id: issues.id });

      if (!created) throw conflict('Kendala gagal dicatat.');
      id = created.id;
    } else {
      await tx
        .update(issues)
        .set({
          title,
          description: input.description,
          severity: input.severity,
          status: input.status,
          periodId: input.periodId,
          updatedBy: user.id,
        })
        .where(and(eq(issues.id, id), eq(issues.projectId, projectId)));
    }

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'issues',
      recordId: id,
      action: issueId === null ? 'INSERT' : 'UPDATE',
      after: { ...input, title },
      actorId: user.id,
    });

    return { id };
  });
}

export async function deleteIssue(
  user: SessionUser,
  projectId: string,
  issueId: string,
): Promise<void> {
  const access = await assertProjectAccess(user.id, projectId, 'ENGINEER');

  await withUser(user.id, async (tx) => {
    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'issues',
      recordId: issueId,
      action: 'DELETE',
      actorId: user.id,
    });
    await tx.delete(issues).where(and(eq(issues.id, issueId), eq(issues.projectId, projectId)));
  });
}
