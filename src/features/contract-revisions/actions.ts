'use server';

import { revalidatePath } from 'next/cache';

import { toUserMessage } from '@/lib/errors';
import { revisionFormSchema } from '@/lib/validation/contract-revision';
import {
  approveRevision,
  cancelRevision,
  createRevision,
  deleteRevision,
  freezeContractBaseline,
} from '@/services/contract-revisions';
import { requireSessionUser } from '@/services/session';

export type ActionResult =
  | { ok: true }
  | { ok: false; message: string; hint?: string; fieldErrors?: Record<string, string> };

function failure(error: unknown): { ok: false; message: string; hint?: string } {
  const { message, hint } = toUserMessage(error);
  return hint === undefined ? { ok: false, message } : { ok: false, message, hint };
}

/**
 * Approving a revision moves volumes, so every page that reads them is stale.
 * Listing them here rather than revalidating the whole layout keeps the
 * invalidation honest about what actually changed.
 */
function revalidateScope(projectId: string): void {
  for (const path of [
    '',
    '/cco',
    '/work-items',
    '/estimate/rab',
    '/estimate/rap',
    '/progress',
    '/scurve',
    '/schedule',
    '/capital',
    '/material',
  ]) {
    revalidatePath(`/projects/${projectId}${path}`);
  }
}

export async function freezeBaselineAction(
  projectId: string,
  notes: string | null,
): Promise<ActionResult> {
  try {
    const user = await requireSessionUser();
    await freezeContractBaseline(user, projectId, notes);
  } catch (error) {
    return failure(error);
  }

  revalidatePath(`/projects/${projectId}/cco`);
  return { ok: true };
}

export async function createRevisionAction(projectId: string, raw: unknown): Promise<ActionResult> {
  const parsed = revisionFormSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? '');
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, message: 'Periksa kembali isian formulir.', fieldErrors };
  }

  try {
    const user = await requireSessionUser();
    await createRevision(user, projectId, {
      title: parsed.data.title,
      reason: parsed.data.reason,
      effectiveDate: parsed.data.effectiveDate,
      lines: parsed.data.lines,
    });
  } catch (error) {
    return failure(error);
  }

  revalidatePath(`/projects/${projectId}/cco`);
  return { ok: true };
}

export async function approveRevisionAction(
  projectId: string,
  revisionId: string,
): Promise<ActionResult> {
  try {
    const user = await requireSessionUser();
    await approveRevision(user, projectId, revisionId);
  } catch (error) {
    return failure(error);
  }

  revalidateScope(projectId);
  return { ok: true };
}

export async function cancelRevisionAction(
  projectId: string,
  revisionId: string,
): Promise<ActionResult> {
  try {
    const user = await requireSessionUser();
    await cancelRevision(user, projectId, revisionId);
  } catch (error) {
    return failure(error);
  }

  revalidatePath(`/projects/${projectId}/cco`);
  return { ok: true };
}

export async function deleteRevisionAction(
  projectId: string,
  revisionId: string,
): Promise<ActionResult> {
  try {
    const user = await requireSessionUser();
    await deleteRevision(user, projectId, revisionId);
  } catch (error) {
    return failure(error);
  }

  revalidatePath(`/projects/${projectId}/cco`);
  return { ok: true };
}
