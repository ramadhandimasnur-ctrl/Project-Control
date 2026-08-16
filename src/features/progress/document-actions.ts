'use server';

import { revalidatePath } from 'next/cache';

import { toUserMessage } from '@/lib/errors';
import {
  createUploadTarget,
  deleteDocument,
  recordDocument,
  setDocumentCaption,
} from '@/services/documents';
import { requireSessionUser } from '@/services/session';

export type ActionResult = { ok: true } | { ok: false; message: string; hint?: string };

function failure(error: unknown): { ok: false; message: string; hint?: string } {
  const { message, hint } = toUserMessage(error);
  return hint === undefined ? { ok: false, message } : { ok: false, message, hint };
}

function revalidateReports(projectId: string): void {
  revalidatePath(`/projects/${projectId}/progress`);
  revalidatePath(`/projects/${projectId}/reports`);
  revalidatePath(`/projects/${projectId}/reports/opname`);
}

export type UploadTargetResult =
  | { ok: true; path: string; token: string }
  | { ok: false; message: string; hint?: string };

/**
 * Authorises one upload.
 *
 * The file itself never comes through here — a server action body is capped in
 * the low megabytes and there is no reason to hold a photograph in the Node
 * process. The browser posts it straight to storage with the token below.
 */
export async function createUploadTargetAction(
  projectId: string,
  periodId: string,
  extension: string,
): Promise<UploadTargetResult> {
  try {
    const user = await requireSessionUser();
    const target = await createUploadTarget(user, projectId, periodId, extension);
    return { ok: true, path: target.path, token: target.token };
  } catch (error) {
    return failure(error);
  }
}

export async function recordDocumentAction(input: {
  projectId: string;
  periodId: string;
  workItemId: string | null;
  storagePath: string;
  caption: string | null;
  byteSize: number | null;
}): Promise<ActionResult> {
  try {
    const user = await requireSessionUser();
    await recordDocument(user, input);
  } catch (error) {
    return failure(error);
  }

  revalidateReports(input.projectId);
  return { ok: true };
}

export async function deleteDocumentAction(
  projectId: string,
  documentId: string,
): Promise<ActionResult> {
  try {
    const user = await requireSessionUser();
    await deleteDocument(user, projectId, documentId);
  } catch (error) {
    return failure(error);
  }

  revalidateReports(projectId);
  return { ok: true };
}

export async function setDocumentCaptionAction(
  projectId: string,
  documentId: string,
  caption: string,
): Promise<ActionResult> {
  try {
    const user = await requireSessionUser();
    await setDocumentCaption(user, projectId, documentId, caption);
  } catch (error) {
    return failure(error);
  }

  revalidateReports(projectId);
  return { ok: true };
}
