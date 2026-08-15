'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { type ProjectRole } from '@/lib/auth/roles';
import { toUserMessage } from '@/lib/errors';
import { projectFormSchema, projectMemberSchema } from '@/lib/validation/project';
import { addMember, changeMemberRole, removeMember } from '@/services/members';
import { createProject, deleteProject, updateProject } from '@/services/projects';
import { requireSessionUser } from '@/services/session';

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

export async function createProjectAction(raw: unknown): Promise<ActionResult> {
  const parsed = projectFormSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Periksa kembali isian formulir.',
      fieldErrors: fieldErrorsOf(parsed.error.issues),
    };
  }

  let projectId: string;
  try {
    const user = await requireSessionUser();
    const created = await createProject(user, parsed.data);
    projectId = created.id;
  } catch (error) {
    return failure(error);
  }

  revalidatePath('/projects');
  redirect(`/projects/${projectId}`);
}

export async function updateProjectAction(
  projectId: string,
  raw: unknown,
): Promise<ActionResult> {
  const parsed = projectFormSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Periksa kembali isian formulir.',
      fieldErrors: fieldErrorsOf(parsed.error.issues),
    };
  }

  try {
    const user = await requireSessionUser();
    await updateProject(user, projectId, parsed.data);
  } catch (error) {
    return failure(error);
  }

  revalidatePath(`/projects/${projectId}`);
  revalidatePath('/projects');
  return { ok: true };
}

export async function deleteProjectAction(projectId: string): Promise<ActionResult> {
  try {
    const user = await requireSessionUser();
    await deleteProject(user, projectId);
  } catch (error) {
    return failure(error);
  }

  revalidatePath('/projects');
  redirect('/projects');
}

export async function addMemberAction(
  projectId: string,
  raw: unknown,
): Promise<ActionResult> {
  const parsed = projectMemberSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Periksa kembali pilihan pengguna dan peran.',
      fieldErrors: fieldErrorsOf(parsed.error.issues),
    };
  }

  try {
    const user = await requireSessionUser();
    await addMember(user, projectId, parsed.data.userId, parsed.data.role);
  } catch (error) {
    return failure(error);
  }

  revalidatePath(`/projects/${projectId}/members`);
  return { ok: true };
}

export async function changeMemberRoleAction(
  projectId: string,
  memberId: string,
  role: ProjectRole,
): Promise<ActionResult> {
  try {
    const user = await requireSessionUser();
    await changeMemberRole(user, projectId, memberId, role);
  } catch (error) {
    return failure(error);
  }

  revalidatePath(`/projects/${projectId}/members`);
  return { ok: true };
}

export async function removeMemberAction(
  projectId: string,
  memberId: string,
): Promise<ActionResult> {
  try {
    const user = await requireSessionUser();
    await removeMember(user, projectId, memberId);
  } catch (error) {
    return failure(error);
  }

  revalidatePath(`/projects/${projectId}/members`);
  return { ok: true };
}
