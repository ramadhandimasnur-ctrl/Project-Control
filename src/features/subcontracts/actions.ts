'use server';

import { revalidatePath } from 'next/cache';

import { toUserMessage } from '@/lib/errors';
import {
  advanceFormSchema,
  certificateFormSchema,
  subcontractFormSchema,
} from '@/lib/validation/subcontract';
import { requireSessionUser } from '@/services/session';
import {
  approveCertificate,
  createCertificate,
  deleteAdvance,
  deleteCertificate,
  markCertificatePaid,
  recordAdvance,
  saveSubcontract,
} from '@/services/subcontracts';

export type ActionResult<T = unknown> =
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

/*
 * A certificate moves money and cost at once, so three screens go stale
 * together: the subcontract list, cost control (which now carries the booked
 * expense), and the cash page (which carries the payable).
 */
function revalidateSubcontracts(projectId: string): void {
  revalidatePath(`/projects/${projectId}/subcontracts`);
  revalidatePath(`/projects/${projectId}/costs`);
  revalidatePath(`/projects/${projectId}/cash`);
}

function failure(error: unknown): ActionResult<never> {
  const { message, hint } = toUserMessage(error);
  return hint === undefined ? { ok: false, message } : { ok: false, message, hint };
}

export async function saveSubcontractAction(
  projectId: string,
  subcontractId: string | null,
  raw: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = subcontractFormSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Periksa kembali isian kontrak.',
      fieldErrors: fieldErrorsOf(parsed.error.issues),
    };
  }

  try {
    const user = await requireSessionUser();
    const { id } = await saveSubcontract(user, projectId, subcontractId, {
      ...parsed.data,
      items: parsed.data.items.map((item) => ({
        ...item,
        workItemId: item.workItemId === '' ? null : item.workItemId,
        unitId: item.unitId === '' ? null : item.unitId,
      })),
    });
    revalidateSubcontracts(projectId);
    return { ok: true, id };
  } catch (error) {
    return failure(error);
  }
}

export async function recordAdvanceAction(
  projectId: string,
  subcontractId: string,
  raw: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = advanceFormSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Periksa kembali isian kasbon.',
      fieldErrors: fieldErrorsOf(parsed.error.issues),
    };
  }

  try {
    const user = await requireSessionUser();
    const { id } = await recordAdvance(user, projectId, subcontractId, parsed.data);
    revalidateSubcontracts(projectId);
    return { ok: true, id };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteAdvanceAction(
  projectId: string,
  advanceId: string,
): Promise<ActionResult> {
  try {
    const user = await requireSessionUser();
    await deleteAdvance(user, projectId, advanceId);
    revalidateSubcontracts(projectId);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function createCertificateAction(
  projectId: string,
  subcontractId: string,
  raw: unknown,
): Promise<ActionResult<{ id: string; netPayable: string }>> {
  const parsed = certificateFormSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Periksa kembali isian sertifikat.',
      fieldErrors: fieldErrorsOf(parsed.error.issues),
    };
  }

  try {
    const user = await requireSessionUser();
    const result = await createCertificate(user, projectId, subcontractId, parsed.data);
    revalidateSubcontracts(projectId);
    return { ok: true, ...result };
  } catch (error) {
    return failure(error);
  }
}

export async function approveCertificateAction(
  projectId: string,
  certificateId: string,
): Promise<ActionResult> {
  try {
    const user = await requireSessionUser();
    await approveCertificate(user, projectId, certificateId);
    revalidateSubcontracts(projectId);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function markCertificatePaidAction(
  projectId: string,
  certificateId: string,
  paidAt: string,
): Promise<ActionResult> {
  try {
    const user = await requireSessionUser();
    await markCertificatePaid(user, projectId, certificateId, paidAt);
    revalidateSubcontracts(projectId);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteCertificateAction(
  projectId: string,
  certificateId: string,
): Promise<ActionResult> {
  try {
    const user = await requireSessionUser();
    await deleteCertificate(user, projectId, certificateId);
    revalidateSubcontracts(projectId);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}
