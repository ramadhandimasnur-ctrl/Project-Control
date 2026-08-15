'use server';

import { revalidatePath } from 'next/cache';

import { toUserMessage } from '@/lib/errors';
import {
  ahspLineFormSchema,
  applyTemplateSchema,
  duplicateWorkItemSchema,
  takeoffFormSchema,
  templateFormSchema,
  workGroupFormSchema,
  workItemFormSchema,
} from '@/lib/validation/work-breakdown';
import { deleteAhspLine, saveAhspLine } from '@/services/ahsp';
import {
  applyTemplate,
  getTemplateLines,
  saveTemplateFromWorkItem,
} from '@/services/ahsp-templates';
import { requireSessionUser } from '@/services/session';
import { deleteTakeoff, saveTakeoff } from '@/services/takeoffs';
import {
  createWorkGroup,
  createWorkItem,
  deleteWorkGroup,
  deleteWorkItem,
  duplicateWorkItem,
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

// --- templates & duplication ------------------------------------------------

export async function saveTemplateAction(
  projectId: string,
  workItemId: string,
  raw: unknown,
): Promise<ActionResult> {
  const parsed = templateFormSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Periksa kembali isian formulir.',
      fieldErrors: fieldErrorsOf(parsed.error.issues),
    };
  }

  try {
    const user = await requireSessionUser();
    await saveTemplateFromWorkItem(user, projectId, workItemId, parsed.data);
  } catch (error) {
    return failure(error);
  }

  revalidateProject(projectId);
  return { ok: true };
}

export type ApplyTemplateActionResult =
  | { ok: true; added: number; skipped: number; removed: number }
  | { ok: false; message: string; hint?: string; fieldErrors?: Record<string, string> };

export async function applyTemplateAction(
  projectId: string,
  workItemId: string,
  raw: unknown,
): Promise<ApplyTemplateActionResult> {
  const parsed = applyTemplateSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Periksa kembali pilihan template.',
      fieldErrors: fieldErrorsOf(parsed.error.issues),
    };
  }

  try {
    const user = await requireSessionUser();
    const result = await applyTemplate(
      user,
      projectId,
      workItemId,
      parsed.data.templateId,
      parsed.data.mode,
    );
    revalidateProject(projectId);
    return { ok: true, ...result };
  } catch (error) {
    return failure(error) as ApplyTemplateActionResult;
  }
}

export type TemplatePreviewLine = {
  resourceCode: string;
  resourceName: string;
  unitCode: string;
  role: string;
  coefRab: string;
  coefRap: string;
  wasteFactor: string;
};

export type TemplatePreviewResult =
  | { ok: true; lines: TemplatePreviewLine[] }
  | { ok: false; message: string; hint?: string };

/** Lets the dialog show what a template contains before it is applied. */
export async function previewTemplateAction(templateId: string): Promise<TemplatePreviewResult> {
  try {
    const user = await requireSessionUser();
    const lines = await getTemplateLines(user.id, templateId);
    return { ok: true, lines };
  } catch (error) {
    return failure(error) as TemplatePreviewResult;
  }
}

export type DuplicateActionResult =
  | { ok: true; id: string }
  | { ok: false; message: string; hint?: string; fieldErrors?: Record<string, string> };

export async function duplicateWorkItemAction(
  projectId: string,
  workItemId: string,
  raw: unknown,
): Promise<DuplicateActionResult> {
  const parsed = duplicateWorkItemSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Periksa kembali isian formulir.',
      fieldErrors: fieldErrorsOf(parsed.error.issues),
    };
  }

  try {
    const user = await requireSessionUser();
    const created = await duplicateWorkItem(user, projectId, workItemId, parsed.data);
    revalidateProject(projectId);
    return { ok: true, id: created.id };
  } catch (error) {
    return failure(error) as DuplicateActionResult;
  }
}
