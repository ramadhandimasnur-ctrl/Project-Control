'use server';

import { revalidatePath } from 'next/cache';

import { toUserMessage } from '@/lib/errors';
import { checklistFormSchema, progressEntryFormSchema } from '@/lib/validation/progress';
import {
  approveManyProgressEntries,
  approveProgressEntry,
  deleteProgressEntry,
  pendingEntryIds,
  rejectProgressEntry,
  saveChecklist,
  saveProgressEntry,
  submitProgressEntry,
} from '@/services/progress';
import { requireSessionUser } from '@/services/session';

export type ActionResult =
  | { ok: true }
  | { ok: false; message: string; hint?: string; fieldErrors?: Record<string, string> };

type Failure = { ok: false; message: string; hint?: string };

function failure(error: unknown): Failure {
  const { message, hint } = toUserMessage(error);
  return hint === undefined ? { ok: false, message } : { ok: false, message, hint };
}

function fieldErrorsOf(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? '');
    if (key && !out[key]) out[key] = issue.message;
  }
  return out;
}

function revalidateProgress(projectId: string): void {
  revalidatePath(`/projects/${projectId}/progress`);
  revalidatePath(`/projects/${projectId}/scurve`);
  revalidatePath(`/projects/${projectId}`);
}

export async function saveProgressAction(
  projectId: string,
  workItemId: string,
  periodId: string,
  raw: unknown,
): Promise<ActionResult> {
  const parsed = progressEntryFormSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Periksa kembali isian progres.',
      fieldErrors: fieldErrorsOf(parsed.error.issues),
    };
  }

  try {
    const user = await requireSessionUser();
    await saveProgressEntry(user, projectId, workItemId, periodId, {
      method: parsed.data.method,
      qtyThisPeriod: parsed.data.qtyThisPeriod,
      pctThisPeriod: parsed.data.pctInput,
      entryDate: parsed.data.entryDate,
      note: parsed.data.note,
    });
  } catch (error) {
    return failure(error);
  }

  revalidateProgress(projectId);
  return { ok: true };
}

export async function submitProgressAction(
  projectId: string,
  entryId: string,
): Promise<ActionResult> {
  try {
    const user = await requireSessionUser();
    await submitProgressEntry(user, projectId, entryId);
  } catch (error) {
    return failure(error);
  }

  revalidateProgress(projectId);
  return { ok: true };
}

export async function approveProgressAction(
  projectId: string,
  entryId: string,
): Promise<ActionResult> {
  try {
    const user = await requireSessionUser();
    await approveProgressEntry(user, projectId, entryId);
  } catch (error) {
    return failure(error);
  }

  revalidateProgress(projectId);
  return { ok: true };
}

export async function rejectProgressAction(
  projectId: string,
  entryId: string,
  reason: string,
): Promise<ActionResult> {
  try {
    const user = await requireSessionUser();
    await rejectProgressEntry(user, projectId, entryId, reason);
  } catch (error) {
    return failure(error);
  }

  revalidateProgress(projectId);
  return { ok: true };
}

export async function deleteProgressAction(
  projectId: string,
  entryId: string,
): Promise<ActionResult> {
  try {
    const user = await requireSessionUser();
    await deleteProgressEntry(user, projectId, entryId);
  } catch (error) {
    return failure(error);
  }

  revalidateProgress(projectId);
  return { ok: true };
}

export type ApproveAllResult =
  | { ok: true; approved: number; skipped: { id: string; reason: string }[] }
  | Failure;

/**
 * Approves everything awaiting a decision in a period.
 *
 * Entries that fail their own checks are reported back rather than silently
 * dropped: a bulk action that quietly skips half its work is worse than one
 * that refuses outright.
 */
export async function approveAllAction(
  projectId: string,
  periodId: string,
): Promise<ApproveAllResult> {
  try {
    const user = await requireSessionUser();
    const ids = await pendingEntryIds(user.id, projectId, periodId);
    const result = await approveManyProgressEntries(user, projectId, ids);
    revalidateProgress(projectId);
    return { ok: true, ...result };
  } catch (error) {
    return failure(error);
  }
}

export async function saveChecklistAction(
  projectId: string,
  workItemId: string,
  periodId: string,
  raw: unknown,
): Promise<ActionResult> {
  const parsed = checklistFormSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Periksa kembali isian checklist.',
      fieldErrors: fieldErrorsOf(parsed.error.issues),
    };
  }

  try {
    const user = await requireSessionUser();
    await saveChecklist(user, projectId, workItemId, periodId, parsed.data);
  } catch (error) {
    return failure(error);
  }

  revalidateProgress(projectId);
  return { ok: true };
}
