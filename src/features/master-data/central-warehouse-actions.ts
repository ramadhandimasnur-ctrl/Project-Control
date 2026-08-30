'use server';

import { revalidatePath } from 'next/cache';

import { toUserMessage } from '@/lib/errors';
import {
  allocateToProject,
  recordReceipt,
  saveCentralWarehouse,
} from '@/services/central-warehouse';
import { requireSessionUser } from '@/services/session';

export type CentralResult =
  | { ok: true; message?: string }
  | { ok: false; message: string; hint?: string };

function failure(error: unknown): CentralResult {
  const { message, hint } = toUserMessage(error);
  return hint === undefined ? { ok: false, message } : { ok: false, message, hint };
}

export async function saveCentralWarehouseAction(
  warehouseId: string | null,
  input: { name: string; city: string; address: string },
): Promise<CentralResult> {
  try {
    const user = await requireSessionUser();
    await saveCentralWarehouse(user, warehouseId, {
      name: input.name.trim(),
      city: input.city.trim() === '' ? null : input.city.trim(),
      address: input.address.trim() === '' ? null : input.address.trim(),
    });
    revalidatePath('/master-data/warehouses');
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function recordReceiptAction(
  warehouseId: string,
  input: {
    resourceId: string;
    receiptDate: string;
    qty: string;
    unitPrice: string;
    vatPercent: string;
    docNo: string;
    dueDate: string;
  },
): Promise<CentralResult> {
  try {
    const user = await requireSessionUser();
    const result = await recordReceipt(user, warehouseId, {
      supplierId: null,
      resourceId: input.resourceId,
      docNo: input.docNo.trim() === '' ? null : input.docNo.trim(),
      receiptDate: input.receiptDate,
      qty: input.qty,
      unitId: null,
      unitPrice: input.unitPrice,
      // Typed as a percentage, stored as a fraction — nobody writes 0,11.
      vatPercent: String((Number(input.vatPercent) || 0) / 100),
      dueDate: input.dueDate.trim() === '' ? null : input.dueDate,
      note: null,
    });
    revalidatePath('/master-data/warehouses');
    return { ok: true, message: `Tercatat, nilai ${result.totalAmount}.` };
  } catch (error) {
    return failure(error);
  }
}

/*
 * Allocating touches a project's stock, so its material and cost screens go
 * stale with it. The path is not known here, so the whole project area is
 * revalidated rather than guessing at which pages read inventory.
 */
export async function allocateAction(
  warehouseId: string,
  input: { projectId: string; resourceId: string; allocatedOn: string; qty: string },
): Promise<CentralResult> {
  try {
    const user = await requireSessionUser();
    const result = await allocateToProject(user, warehouseId, {
      projectId: input.projectId,
      resourceId: input.resourceId,
      allocatedOn: input.allocatedOn,
      qty: input.qty,
      note: null,
    });
    revalidatePath('/master-data/warehouses');
    revalidatePath(`/projects/${input.projectId}`, 'layout');
    return { ok: true, message: `Dialokasikan pada harga ${result.unitCost}.` };
  } catch (error) {
    return failure(error);
  }
}
