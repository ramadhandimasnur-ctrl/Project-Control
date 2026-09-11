'use server';

import { revalidatePath } from 'next/cache';

import { toUserMessage } from '@/lib/errors';
import { dailyLaborFormSchema, foremanFormSchema } from '@/lib/validation/labor';
import {
  approveDailyLabor,
  deleteDailyLabor,
  markDailyLaborPaid,
  saveDailyLabor,
  saveForeman,
} from '@/services/daily-labor';
import { requireSessionUser } from '@/services/session';

export type LaborResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; message: string; hint?: string; fieldErrors?: Record<string, string> };

function fieldErrorsOf(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join('.');
    if (key !== '' && errors[key] === undefined) errors[key] = issue.message;
  }
  return errors;
}

function failure(error: unknown): LaborResult<never> {
  const { message, hint } = toUserMessage(error);
  return hint === undefined ? { ok: false, message } : { ok: false, message, hint };
}

/*
 * A day of labour is money against work items, so cost control and the
 * operational report go stale with it. The project dashboard quotes the same
 * totals, which is why it is refreshed too.
 */
function revalidateLabor(projectId: string): void {
  revalidatePath(`/projects/${projectId}/labor`);
  revalidatePath(`/projects/${projectId}/costs`);
  revalidatePath(`/projects/${projectId}/reports/rap`);
  revalidatePath(`/projects/${projectId}`);
}

export async function saveDailyLaborAction(
  projectId: string,
  dailyLaborId: string | null,
  raw: unknown,
): Promise<LaborResult<{ id: string; grossAmount: string }>> {
  const parsed = dailyLaborFormSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Periksa kembali isian upah harian.',
      fieldErrors: fieldErrorsOf(parsed.error.issues),
    };
  }

  try {
    const user = await requireSessionUser();
    const result = await saveDailyLabor(user, projectId, dailyLaborId, {
      workDate: parsed.data.workDate,
      periodId: parsed.data.periodId === '' ? null : parsed.data.periodId,
      foremanId: parsed.data.foremanId === '' ? null : parsed.data.foremanId,
      workerCount: parsed.data.workerCount,
      dayFraction: parsed.data.dayFraction,
      dailyRate: parsed.data.dailyRate,
      note: parsed.data.note,
      lines: parsed.data.lines.map((line) => ({
        workItemId: line.workItemId === '' ? null : line.workItemId,
        personDays: line.personDays,
        qtyOutput: line.qtyOutput,
        note: line.note,
      })),
    });
    revalidateLabor(projectId);
    return { ok: true, ...result };
  } catch (error) {
    return failure(error);
  }
}

export async function approveDailyLaborAction(
  projectId: string,
  dailyLaborId: string,
): Promise<LaborResult> {
  try {
    const user = await requireSessionUser();
    await approveDailyLabor(user, projectId, dailyLaborId);
    revalidateLabor(projectId);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function markDailyLaborPaidAction(
  projectId: string,
  dailyLaborId: string,
  paidAt: string,
): Promise<LaborResult> {
  try {
    const user = await requireSessionUser();
    await markDailyLaborPaid(user, projectId, dailyLaborId, {
      paidAt,
      paymentMethod: null,
      refNo: null,
    });
    revalidateLabor(projectId);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteDailyLaborAction(
  projectId: string,
  dailyLaborId: string,
): Promise<LaborResult> {
  try {
    const user = await requireSessionUser();
    await deleteDailyLabor(user, projectId, dailyLaborId);
    revalidateLabor(projectId);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function saveForemanAction(
  foremanId: string | null,
  raw: unknown,
): Promise<LaborResult<{ id: string }>> {
  const parsed = foremanFormSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Periksa kembali isian mandor.',
      fieldErrors: fieldErrorsOf(parsed.error.issues),
    };
  }

  try {
    const user = await requireSessionUser();
    const { id } = await saveForeman(user, foremanId, parsed.data);
    revalidatePath('/master-data/foremen');
    return { ok: true, id };
  } catch (error) {
    return failure(error);
  }
}
