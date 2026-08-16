'use server';

import { revalidatePath } from 'next/cache';

import { toUserMessage } from '@/lib/errors';
import { SIGNATORY_SLOTS, type SignatorySlot } from '@/lib/reports/signatories';
import { requireSessionUser } from '@/services/session';
import {
  clearSignature,
  createSignatureUploadTarget,
  saveSignatory,
} from '@/services/signatories';

export type ActionResult = { ok: true } | { ok: false; message: string; hint?: string };

function failure(error: unknown): { ok: false; message: string; hint?: string } {
  const { message, hint } = toUserMessage(error);
  return hint === undefined ? { ok: false, message } : { ok: false, message, hint };
}

function revalidateSheets(projectId: string): void {
  revalidatePath(`/projects/${projectId}/reports`);
  revalidatePath(`/projects/${projectId}/reports/opname`);
}

function isSlot(value: string): value is SignatorySlot {
  return (SIGNATORY_SLOTS as readonly string[]).includes(value);
}

export async function saveSignatoryAction(
  projectId: string,
  slot: string,
  input: { name: string; position: string; signaturePath?: string | null },
): Promise<ActionResult> {
  if (!isSlot(slot)) return { ok: false, message: 'Kolom pengesahan tidak dikenal.' };

  try {
    const user = await requireSessionUser();
    await saveSignatory(user, projectId, {
      slot,
      name: input.name,
      position: input.position,
      ...(input.signaturePath === undefined ? {} : { signaturePath: input.signaturePath }),
    });
  } catch (error) {
    return failure(error);
  }

  revalidateSheets(projectId);
  return { ok: true };
}

export type SignatureTargetResult =
  | { ok: true; path: string; token: string }
  | { ok: false; message: string; hint?: string };

export async function createSignatureTargetAction(
  projectId: string,
  slot: string,
): Promise<SignatureTargetResult> {
  if (!isSlot(slot)) return { ok: false, message: 'Kolom pengesahan tidak dikenal.' };

  try {
    const user = await requireSessionUser();
    const target = await createSignatureUploadTarget(user, projectId, slot);
    return { ok: true, path: target.path, token: target.token };
  } catch (error) {
    return failure(error);
  }
}

export async function clearSignatureAction(
  projectId: string,
  slot: string,
): Promise<ActionResult> {
  if (!isSlot(slot)) return { ok: false, message: 'Kolom pengesahan tidak dikenal.' };

  try {
    const user = await requireSessionUser();
    await clearSignature(user, projectId, slot);
  } catch (error) {
    return failure(error);
  }

  revalidateSheets(projectId);
  return { ok: true };
}
