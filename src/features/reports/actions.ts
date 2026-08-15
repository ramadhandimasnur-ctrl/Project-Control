'use server';

import { revalidatePath } from 'next/cache';

import { toUserMessage } from '@/lib/errors';
import { deleteIssue, publishReport, saveIssue, type ReportType } from '@/services/reports';
import { requireSessionUser } from '@/services/session';

export type ActionResult = { ok: true } | { ok: false; message: string; hint?: string };

function failure(error: unknown): { ok: false; message: string; hint?: string } {
  const { message, hint } = toUserMessage(error);
  return hint === undefined ? { ok: false, message } : { ok: false, message, hint };
}

function revalidateReports(projectId: string): void {
  revalidatePath(`/projects/${projectId}/reports`);
}

export type PublishResult = { ok: true; id: string } | { ok: false; message: string; hint?: string };

export async function publishReportAction(
  projectId: string,
  periodId: string,
  reportType: string,
): Promise<PublishResult> {
  if (reportType !== 'DAILY' && reportType !== 'WEEKLY' && reportType !== 'MONTHLY') {
    return { ok: false, message: 'Jenis laporan tidak dikenal.' };
  }

  try {
    const user = await requireSessionUser();
    const result = await publishReport(user, projectId, periodId, reportType as ReportType);
    revalidateReports(projectId);
    return { ok: true, id: result.id };
  } catch (error) {
    return failure(error);
  }
}

export async function saveIssueAction(
  projectId: string,
  issueId: string | null,
  input: {
    title: string;
    description: string | null;
    severity: 'LOW' | 'MEDIUM' | 'HIGH';
    status: 'OPEN' | 'IN_PROGRESS' | 'CLOSED';
    periodId: string | null;
  },
): Promise<ActionResult> {
  try {
    const user = await requireSessionUser();
    await saveIssue(user, projectId, issueId, input);
  } catch (error) {
    return failure(error);
  }

  revalidateReports(projectId);
  return { ok: true };
}

export async function deleteIssueAction(
  projectId: string,
  issueId: string,
): Promise<ActionResult> {
  try {
    const user = await requireSessionUser();
    await deleteIssue(user, projectId, issueId);
  } catch (error) {
    return failure(error);
  }

  revalidateReports(projectId);
  return { ok: true };
}
