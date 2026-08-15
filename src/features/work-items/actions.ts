'use server';

import { revalidatePath } from 'next/cache';

import { toUserMessage } from '@/lib/errors';
import {
  ahspLineFormSchema,
  takeoffFormSchema,
  workGroupFormSchema,
  workItemFormSchema,
} from '@/lib/validation/work-breakdown';
import { deleteAhspLine, saveAhspLine } from '@/services/ahsp';
import { requireSessionUser } from '@/services/session';
import { deleteTakeoff, saveTakeoff } from '@/services/takeoffs';
import {
  createWorkGroup,
  createWorkItem,
  deleteWorkGroup,
  deleteWorkItem,
  setWorkItemActive,
  updateWorkGroup,
  updateWorkItem,
} from '@/services/work-breakdown';

export type ActionResult =
  | { ok: true }
  | { ok: false; message: string; hint?: string; fieldErrors?: Record<string, string> };

function fieldErrorsOf(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? '');
    if (key && !out[key]) out[key] = issue.message;
  }
  return out;
}

function failure(error: unknown): ActionResult {
  const { message, hint } = toUserMessage(error);
  return hint === undefined ? { ok: false, message } : { ok: false, message, hint };
}

function revalidateProject(projectId: string): void {
  revalidatePath(`/projects/${projectId}/work-items`);
  revalidatePath(`/projects/${projectId}/estimate`);
}

// --- work items -------------------------------------------------------------

export async function saveWorkItemAction(
  projectId: string,
  workItemId: string | null,
  raw: unknown,
): Promise<ActionResult> {
  const parsed = workItemFormSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Periksa kembali isian formulir.',
      fieldErrors: fieldErrorsOf(parsed.error.issues),
    };
  }

  try {
    const user = await requireSessionUser();
    if (workItemId === null) await createWorkItem(user, projectId, parsed.data);
    else await updateWorkItem(user, projectId, workItemId, parsed.data);
  } catch (error) {
    return failure(error);
  }

  revalidateProject(projectId);
  return { ok: true };
}

export async function deleteWorkItemAction(
  projectId: string,
  workItemId: string,
): Promise<ActionResult> {
  try {
    const user = await requireSessionUser();
    await deleteWorkItem(user, projectId, workItemId);
  } catch (error) {
    return failure(error);
  }

  revalidateProject(projectId);
  return { ok: true };
}

export async function setWorkItemActiveAction(
  projectId: string,
  workItemId: string,
  isActive: boolean,
): Promise<ActionResult> {
  try {
    const user = await requireSessionUser();
    await setWorkItemActive(user, projectId, workItemId, isActive);
  } catch (error) {
    return failure(error);
  }

  revalidateProject(projectId);
  return { ok: true };
}

// --- work groups ------------------------------------------------------------

export async function saveWorkGroupAction(
  projectId: string,
  groupId: string | null,
  raw: unknown,
): Promise<ActionResult> {
  const parsed = workGroupFormSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Periksa kembali isian formulir.',
      fieldErrors: fieldErrorsOf(parsed.error.issues),
    };
  }

  try {
    const user = await requireSessionUser();
    if (groupId === null) await createWorkGroup(user, projectId, parsed.data);
    else await updateWorkGroup(user, projectId, groupId, parsed.data);
  } catch (error) {
    return failure(error);
  }

  revalidateProject(projectId);
  return { ok: true };
}

export async function deleteWorkGroupAction(
  projectId: string,
  groupId: string,
): Promise<ActionResult> {
  try {
    const user = await requireSessionUser();
    await deleteWorkGroup(user, projectId, groupId);
  } catch (error) {
    return failure(error);
  }

  revalidateProject(projectId);
  return { ok: true };
}

// --- take-offs --------------------------------------------------------------

export type TakeoffActionResult =
  | { ok: true; volume: string | null }
  | { ok: false; message: string; hint?: string; fieldErrors?: Record<string, string> };

export async function saveTakeoffAction(
  projectId: string,
  workItemId: string,
  takeoffId: string | null,
  raw: unknown,
): Promise<TakeoffActionResult> {
  const parsed = takeoffFormSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Periksa kembali isian formulir.',
      fieldErrors: fieldErrorsOf(parsed.error.issues),
    };
  }

  try {
    const user = await requireSessionUser();
    const result = await saveTakeoff(user, projectId, workItemId, takeoffId, parsed.data);
    revalidateProject(projectId);
    return { ok: true, volume: result.volume };
  } catch (error) {
    const failed = failure(error);
    return failed as TakeoffActionResult;
  }
}

export async function deleteTakeoffAction(
  projectId: string,
  workItemId: string,
  takeoffId: string,
): Promise<TakeoffActionResult> {
  try {
    const user = await requireSessionUser();
    const result = await deleteTakeoff(user, projectId, workItemId, takeoffId);
    revalidateProject(projectId);
    return { ok: true, volume: result.volume };
  } catch (error) {
    return failure(error) as TakeoffActionResult;
  }
}

// --- AHSP lines -------------------------------------------------------------

export async function saveAhspLineAction(
  projectId: string,
  workItemId: string,
  lineId: string | null,
  raw: unknown,
): Promise<ActionResult> {
  const parsed = ahspLineFormSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Periksa kembali isian formulir.',
      fieldErrors: fieldErrorsOf(parsed.error.issues),
    };
  }

  try {
    const user = await requireSessionUser();
    await saveAhspLine(user, projectId, workItemId, lineId, parsed.data);
  } catch (error) {
    return failure(error);
  }

  revalidateProject(projectId);
  return { ok: true };
}

export async function deleteAhspLineAction(
  projectId: string,
  workItemId: string,
  lineId: string,
): Promise<ActionResult> {
  try {
    const user = await requireSessionUser();
    await deleteAhspLine(user, projectId, workItemId, lineId);
  } catch (error) {
    return failure(error);
  }

  revalidateProject(projectId);
  return { ok: true };
}
