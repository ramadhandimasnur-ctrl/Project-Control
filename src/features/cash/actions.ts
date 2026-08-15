'use server';

import { revalidatePath } from 'next/cache';

import { toUserMessage } from '@/lib/errors';
import {
  cashAccountFormSchema,
  cashTransactionFormSchema,
  claimFormSchema,
  payClaimFormSchema,
  paymentTermFormSchema,
} from '@/lib/validation/cash';
import {
  createClaim,
  deletePaymentTerm,
  payClaim,
  previewClaim,
  recordCashTransaction,
  saveCashAccount,
  savePaymentTerm,
  voidCashTransaction,
} from '@/services/cash';
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

function revalidateMoney(projectId: string): void {
  revalidatePath(`/projects/${projectId}/cash`);
  revalidatePath(`/projects/${projectId}/capital`);
  revalidatePath(`/projects/${projectId}`);
}

export async function saveCashAccountAction(
  projectId: string,
  accountId: string | null,
  raw: unknown,
): Promise<ActionResult> {
  const parsed = cashAccountFormSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Periksa kembali isian akun kas.',
      fieldErrors: fieldErrorsOf(parsed.error.issues),
    };
  }

  try {
    const user = await requireSessionUser();
    await saveCashAccount(user, projectId, accountId, parsed.data);
  } catch (error) {
    return failure(error);
  }

  revalidateMoney(projectId);
  return { ok: true };
}

export async function savePaymentTermAction(
  projectId: string,
  termId: string | null,
  raw: unknown,
): Promise<ActionResult> {
  const parsed = paymentTermFormSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Periksa kembali isian termin.',
      fieldErrors: fieldErrorsOf(parsed.error.issues),
    };
  }

  try {
    const user = await requireSessionUser();
    await savePaymentTerm(user, projectId, termId, {
      seq: parsed.data.seq,
      name: parsed.data.name,
      termType: parsed.data.termType,
      percent: parsed.data.percentInput,
      amount: parsed.data.amount,
      triggerProgressPct: parsed.data.triggerInput,
      plannedDate: parsed.data.plannedDate,
      verificationDays: parsed.data.verificationDays,
      paymentLagDays: parsed.data.paymentLagDays,
      dpRecoupmentPercent: parsed.data.dpRecoupmentInput ?? '0',
      note: parsed.data.note,
    });
  } catch (error) {
    return failure(error);
  }

  revalidateMoney(projectId);
  return { ok: true };
}

export async function deletePaymentTermAction(
  projectId: string,
  termId: string,
): Promise<ActionResult> {
  try {
    const user = await requireSessionUser();
    await deletePaymentTerm(user, projectId, termId);
  } catch (error) {
    return failure(error);
  }

  revalidateMoney(projectId);
  return { ok: true };
}

export type ClaimPreviewResult =
  | {
      ok: true;
      preview: {
        grossAmount: string;
        dpRecoupment: string;
        retentionWithheld: string;
        vatAmount: string;
        whtAmount: string;
        netAmount: string;
        previouslyCertifiedPct: string;
        dpOutstanding: string;
      };
    }
  | Failure;

/** Computes the figures without writing, for the confirmation dialog. */
export async function previewClaimAction(
  projectId: string,
  termId: string,
  certifiedPercent: number,
): Promise<ClaimPreviewResult> {
  try {
    const user = await requireSessionUser();
    const preview = await previewClaim(
      user.id,
      projectId,
      termId,
      String(certifiedPercent / 100),
    );

    return {
      ok: true,
      preview: {
        grossAmount: preview.grossAmount.toString(),
        dpRecoupment: preview.dpRecoupment.toString(),
        retentionWithheld: preview.retentionWithheld.toString(),
        vatAmount: preview.vatAmount.toString(),
        whtAmount: preview.whtAmount.toString(),
        netAmount: preview.netAmount.toString(),
        previouslyCertifiedPct: preview.previouslyCertifiedPct,
        dpOutstanding: preview.dpOutstanding,
      },
    };
  } catch (error) {
    return failure(error);
  }
}

export async function createClaimAction(projectId: string, raw: unknown): Promise<ActionResult> {
  const parsed = claimFormSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Periksa kembali isian tagihan.',
      fieldErrors: fieldErrorsOf(parsed.error.issues),
    };
  }

  try {
    const user = await requireSessionUser();
    await createClaim(user, projectId, {
      paymentTermId: parsed.data.paymentTermId,
      claimNo: parsed.data.claimNo,
      claimDate: parsed.data.claimDate,
      periodId: null,
      certifiedProgressPct: parsed.data.certifiedInput,
    });
  } catch (error) {
    return failure(error);
  }

  revalidateMoney(projectId);
  return { ok: true };
}

export async function payClaimAction(
  projectId: string,
  claimId: string,
  raw: unknown,
): Promise<ActionResult> {
  const parsed = payClaimFormSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Periksa kembali isian pembayaran.',
      fieldErrors: fieldErrorsOf(parsed.error.issues),
    };
  }

  try {
    const user = await requireSessionUser();
    await payClaim(user, projectId, claimId, parsed.data);
  } catch (error) {
    return failure(error);
  }

  revalidateMoney(projectId);
  return { ok: true };
}

export async function recordCashAction(projectId: string, raw: unknown): Promise<ActionResult> {
  const parsed = cashTransactionFormSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Periksa kembali isian transaksi.',
      fieldErrors: fieldErrorsOf(parsed.error.issues),
    };
  }

  try {
    const user = await requireSessionUser();
    await recordCashTransaction(user, projectId, parsed.data);
  } catch (error) {
    return failure(error);
  }

  revalidateMoney(projectId);
  return { ok: true };
}

export async function voidCashAction(
  projectId: string,
  transactionId: string,
  reason: string,
): Promise<ActionResult> {
  try {
    const user = await requireSessionUser();
    await voidCashTransaction(user, projectId, transactionId, reason);
  } catch (error) {
    return failure(error);
  }

  revalidateMoney(projectId);
  return { ok: true };
}
