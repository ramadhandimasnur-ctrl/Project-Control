'use server';

import { revalidatePath } from 'next/cache';

import { toUserMessage } from '@/lib/errors';
import {
  baselineFormSchema,
  periodTypeSchema,
  workItemScheduleFormSchema,
} from '@/lib/validation/schedule';
import {
  activateBaseline,
  autoDistributeWorkItem,
  createBaseline,
  previewPeriodPlan,
  regeneratePeriods,
  savePlannedDistribution,
  saveWorkItemSchedule,
  type PeriodPlanPreview,
} from '@/services/schedule';
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

function revalidateSchedule(projectId: string): void {
  revalidatePath(`/projects/${projectId}/schedule`);
  revalidatePath(`/projects/${projectId}/scurve`);
}

// --- periods ----------------------------------------------------------------

export type PreviewPeriodsResult =
  | { ok: true; preview: PeriodPlanPreview }
  | { ok: false; message: string; hint?: string };

export async function previewPeriodsAction(
  projectId: string,
  periodType: string,
): Promise<PreviewPeriodsResult> {
  const parsed = periodTypeSchema.safeParse(periodType);
  if (!parsed.success) return { ok: false, message: 'Satuan periode tidak dikenal.' };

  try {
    const user = await requireSessionUser();
    const preview = await previewPeriodPlan(user.id, projectId, parsed.data);
    return { ok: true, preview };
  } catch (error) {
    return failure(error);
  }
}

export type RegenerateResult =
  | { ok: true; kept: number; added: number; removed: number }
  | { ok: false; message: string; hint?: string };

export async function regeneratePeriodsAction(
  projectId: string,
  periodType: string,
): Promise<RegenerateResult> {
  const parsed = periodTypeSchema.safeParse(periodType);
  if (!parsed.success) return { ok: false, message: 'Satuan periode tidak dikenal.' };

  try {
    const user = await requireSessionUser();
    const result = await regeneratePeriods(user, projectId, parsed.data);
    revalidateSchedule(projectId);
    return { ok: true, ...result };
  } catch (error) {
    return failure(error);
  }
}

// --- work item schedule -----------------------------------------------------

export async function saveWorkItemScheduleAction(
  projectId: string,
  workItemId: string,
  raw: unknown,
): Promise<ActionResult> {
  const parsed = workItemScheduleFormSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Periksa kembali isian jadwal.',
      fieldErrors: fieldErrorsOf(parsed.error.issues),
    };
  }

  try {
    const user = await requireSessionUser();
    await saveWorkItemSchedule(user, projectId, workItemId, parsed.data);
  } catch (error) {
    return failure(error);
  }

  revalidateSchedule(projectId);
  return { ok: true };
}

export type AutoDistributeResult =
  | { ok: true; cells: number }
  | { ok: false; message: string; hint?: string };

export async function autoDistributeAction(
  projectId: string,
  workItemId: string,
): Promise<AutoDistributeResult> {
  try {
    const user = await requireSessionUser();
    const result = await autoDistributeWorkItem(user, projectId, workItemId);
    revalidateSchedule(projectId);
    return { ok: true, cells: result.cells };
  } catch (error) {
    return failure(error);
  }
}

export async function saveDistributionAction(
  projectId: string,
  workItemId: string,
  rows: { periodId: string; plannedPct: string }[],
): Promise<ActionResult> {
  try {
    const user = await requireSessionUser();
    await savePlannedDistribution(user, projectId, workItemId, rows);
  } catch (error) {
    return failure(error);
  }

  revalidateSchedule(projectId);
  return { ok: true };
}

// --- baseline ---------------------------------------------------------------

export async function createBaselineAction(
  projectId: string,
  raw: unknown,
): Promise<ActionResult> {
  const parsed = baselineFormSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Periksa kembali isian baseline.',
      fieldErrors: fieldErrorsOf(parsed.error.issues),
    };
  }

  try {
    const user = await requireSessionUser();
    await createBaseline(user, projectId, parsed.data.name);
  } catch (error) {
    return failure(error);
  }

  revalidateSchedule(projectId);
  return { ok: true };
}

export async function activateBaselineAction(
  projectId: string,
  baselineId: string,
): Promise<ActionResult> {
  try {
    const user = await requireSessionUser();
    await activateBaseline(user, projectId, baselineId);
  } catch (error) {
    return failure(error);
  }

  revalidateSchedule(projectId);
  return { ok: true };
}
