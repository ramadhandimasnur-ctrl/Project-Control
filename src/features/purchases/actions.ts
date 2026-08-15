'use server';

import { revalidatePath } from 'next/cache';

import { toUserMessage } from '@/lib/errors';
import { recordMovement, voidMovement, type MovementInput } from '@/services/material-transactions';
import {
  postPurchase,
  previewPurchasePosting,
  saveDraftPurchase,
  voidPurchase,
  type PostingImpact,
  type PurchaseHeaderInput,
  type PurchaseLineInput,
} from '@/services/purchases';
import { requireSessionUser } from '@/services/session';
import { deleteWarehouse, saveWarehouse } from '@/services/warehouses';

export type ActionResult =
  | { ok: true }
  | { ok: false; message: string; hint?: string };

function failure(error: unknown): { ok: false; message: string; hint?: string } {
  const { message, hint } = toUserMessage(error);
  return hint === undefined ? { ok: false, message } : { ok: false, message, hint };
}

function revalidateLogistics(projectId: string): void {
  revalidatePath(`/projects/${projectId}/material`);
  revalidatePath(`/projects/${projectId}/purchases`);
  revalidatePath(`/projects/${projectId}/warehouse`);
}

// --- purchases --------------------------------------------------------------

export type SavePurchaseResult = { ok: true; id: string } | { ok: false; message: string; hint?: string };

export async function savePurchaseAction(
  projectId: string,
  purchaseId: string | null,
  header: PurchaseHeaderInput,
  lines: PurchaseLineInput[],
): Promise<SavePurchaseResult> {
  try {
    const user = await requireSessionUser();
    const saved = await saveDraftPurchase(user, projectId, purchaseId, header, lines);
    revalidateLogistics(projectId);
    return { ok: true, id: saved.id };
  } catch (error) {
    return failure(error);
  }
}

export type PreviewResult =
  | { ok: true; impact: PostingImpact }
  | { ok: false; message: string; hint?: string };

/**
 * Computes the effect of posting without writing anything, so the confirmation
 * dialog can state it in concrete terms (charter section 6.5).
 */
export async function previewPostingAction(
  projectId: string,
  purchaseId: string,
): Promise<PreviewResult> {
  try {
    const user = await requireSessionUser();
    const impact = await previewPurchasePosting(user.id, projectId, purchaseId);
    return { ok: true, impact };
  } catch (error) {
    return failure(error);
  }
}

export async function postPurchaseAction(
  projectId: string,
  purchaseId: string,
): Promise<ActionResult> {
  try {
    const user = await requireSessionUser();
    await postPurchase(user, projectId, purchaseId);
  } catch (error) {
    return failure(error);
  }

  revalidateLogistics(projectId);
  revalidatePath(`/projects/${projectId}/purchases/${purchaseId}`);
  return { ok: true };
}

export async function voidPurchaseAction(
  projectId: string,
  purchaseId: string,
  reason: string,
): Promise<ActionResult> {
  try {
    const user = await requireSessionUser();
    await voidPurchase(user, projectId, purchaseId, reason);
  } catch (error) {
    return failure(error);
  }

  revalidateLogistics(projectId);
  revalidatePath(`/projects/${projectId}/purchases/${purchaseId}`);
  return { ok: true };
}

// --- movements --------------------------------------------------------------

export async function recordMovementAction(
  projectId: string,
  input: MovementInput,
): Promise<ActionResult> {
  try {
    const user = await requireSessionUser();
    await recordMovement(user, projectId, input);
  } catch (error) {
    return failure(error);
  }

  revalidateLogistics(projectId);
  return { ok: true };
}

export async function voidMovementAction(
  projectId: string,
  movementId: string,
  reason: string,
): Promise<ActionResult> {
  try {
    const user = await requireSessionUser();
    await voidMovement(user, projectId, movementId, reason);
  } catch (error) {
    return failure(error);
  }

  revalidateLogistics(projectId);
  return { ok: true };
}

// --- warehouses -------------------------------------------------------------

export async function saveWarehouseAction(
  projectId: string,
  warehouseId: string | null,
  input: { name: string; isDefault: boolean },
): Promise<ActionResult> {
  try {
    const user = await requireSessionUser();
    await saveWarehouse(user, projectId, warehouseId, input);
  } catch (error) {
    return failure(error);
  }

  revalidateLogistics(projectId);
  return { ok: true };
}

export async function deleteWarehouseAction(
  projectId: string,
  warehouseId: string,
): Promise<ActionResult> {
  try {
    const user = await requireSessionUser();
    await deleteWarehouse(user, projectId, warehouseId);
  } catch (error) {
    return failure(error);
  }

  revalidateLogistics(projectId);
  return { ok: true };
}
