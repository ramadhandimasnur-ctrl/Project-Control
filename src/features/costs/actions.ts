'use server';

import { revalidatePath } from 'next/cache';

import { toUserMessage } from '@/lib/errors';
import { actualCostFormSchema } from '@/lib/validation/costs';
import { deleteActualCost, saveActualCost } from '@/services/costs';
import { requireSessionUser } from '@/services/session';

export type ActualCostActionResult =
  | { ok: true; id: string }
  | { ok: false; message: string; hint?: string; fieldErrors?: Record<string, string> };

function fieldErrorsOf(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? '');
    if (key !== '' && errors[key] === undefined) errors[key] = issue.message;
  }
  return errors;
}

/*
 * Cost control reads from three screens at once, so all three are refreshed:
 * the ledger changed, the per-item totals changed, and the executive summary
 * quotes the same figures. Leaving one stale would show two different answers
 * to the same question depending on which tab was open.
 */
function revalidateCosts(projectId: string): void {
  revalidatePath(`/projects/${projectId}/costs`);
  revalidatePath(`/projects/${projectId}/capital`);
  revalidatePath(`/projects/${projectId}`);
}

export async function saveActualCostAction(
  projectId: string,
  costId: string | null,
  raw: unknown,
): Promise<ActualCostActionResult> {
  const parsed = actualCostFormSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Periksa kembali isian biaya.',
      fieldErrors: fieldErrorsOf(parsed.error.issues),
    };
  }

  try {
    const user = await requireSessionUser();
    const { id } = await saveActualCost(user, projectId, costId, parsed.data);
    revalidateCosts(projectId);
    return { ok: true, id };
  } catch (error) {
    const { message, hint } = toUserMessage(error);
    return hint === undefined ? { ok: false, message } : { ok: false, message, hint };
  }
}

export async function deleteActualCostAction(
  projectId: string,
  costId: string,
): Promise<{ ok: true } | { ok: false; message: string; hint?: string }> {
  try {
    const user = await requireSessionUser();
    await deleteActualCost(user, projectId, costId);
    revalidateCosts(projectId);
    return { ok: true };
  } catch (error) {
    const { message, hint } = toUserMessage(error);
    return hint === undefined ? { ok: false, message } : { ok: false, message, hint };
  }
}
