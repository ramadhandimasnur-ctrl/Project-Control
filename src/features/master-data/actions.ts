'use server';

import { revalidatePath } from 'next/cache';

import { toUserMessage } from '@/lib/errors';
import {
  categoryFormSchema,
  priceFormSchema,
  resourceFormSchema,
  supplierFormSchema,
  unitFormSchema,
} from '@/lib/validation/master-data';
import { setPrice } from '@/services/prices';
import {
  createCategory,
  deleteCategory,
  updateCategory,
} from '@/services/resource-categories';
import {
  createResource,
  deleteManyResources,
  deleteResource,
  setResourceActive,
  updateResource,
} from '@/services/resources';
import { requireSessionUser } from '@/services/session';
import { createSupplier, deleteSupplier, updateSupplier } from '@/services/suppliers';
import { createUnit, deleteUnit, updateUnit } from '@/services/units';

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

const CATALOGUE_PATHS = [
  '/master-data/resources',
  '/master-data/units',
  '/master-data/suppliers',
  '/master-data/categories',
];

function revalidateCatalogue(): void {
  for (const path of CATALOGUE_PATHS) revalidatePath(path);
}

// --- resources --------------------------------------------------------------

export async function saveResourceAction(
  resourceId: string | null,
  raw: unknown,
): Promise<ActionResult> {
  const parsed = resourceFormSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Periksa kembali isian formulir.',
      fieldErrors: fieldErrorsOf(parsed.error.issues),
    };
  }

  try {
    const user = await requireSessionUser();
    if (resourceId === null) await createResource(user, parsed.data);
    else await updateResource(user, resourceId, parsed.data);
  } catch (error) {
    return failure(error);
  }

  revalidateCatalogue();
  if (resourceId !== null) revalidatePath(`/master-data/resources/${resourceId}`);
  return { ok: true };
}

export async function setResourceActiveAction(
  resourceId: string,
  isActive: boolean,
): Promise<ActionResult> {
  try {
    const user = await requireSessionUser();
    await setResourceActive(user, resourceId, isActive);
  } catch (error) {
    return failure(error);
  }

  revalidateCatalogue();
  revalidatePath(`/master-data/resources/${resourceId}`);
  return { ok: true };
}

export async function deleteResourceAction(resourceId: string): Promise<ActionResult> {
  try {
    const user = await requireSessionUser();
    await deleteResource(user, resourceId);
  } catch (error) {
    return failure(error);
  }

  revalidateCatalogue();
  return { ok: true };
}

export type BulkDeleteActionResult =
  | { ok: true; deleted: number; refused: { id: string; name: string; reason: string }[] }
  | { ok: false; message: string; hint?: string };

/**
 * Deletes a selection, reporting exactly what happened to each one.
 *
 * A bulk action that silently drops the ones it could not do is worse than one
 * that refuses outright — the user walks away believing the list is clean.
 */
export async function deleteResourcesAction(
  resourceIds: string[],
): Promise<BulkDeleteActionResult> {
  try {
    const user = await requireSessionUser();
    const result = await deleteManyResources(user, resourceIds);
    revalidateCatalogue();
    return { ok: true, deleted: result.deleted, refused: result.refused };
  } catch (error) {
    const { message, hint } = toUserMessage(error);
    return hint === undefined ? { ok: false, message } : { ok: false, message, hint };
  }
}

// --- categories -------------------------------------------------------------

export async function saveCategoryAction(
  categoryId: string | null,
  raw: unknown,
): Promise<ActionResult> {
  const parsed = categoryFormSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Periksa kembali isian formulir.',
      fieldErrors: fieldErrorsOf(parsed.error.issues),
    };
  }

  try {
    const user = await requireSessionUser();
    const input = {
      code: parsed.data.code,
      name: parsed.data.name,
      type: parsed.data.type,
      parentId: parsed.data.parentId,
    };

    if (categoryId === null) await createCategory(user, input);
    else await updateCategory(user, categoryId, input);
  } catch (error) {
    return failure(error);
  }

  revalidateCatalogue();
  return { ok: true };
}

export async function deleteCategoryAction(categoryId: string): Promise<ActionResult> {
  try {
    const user = await requireSessionUser();
    await deleteCategory(user, categoryId);
  } catch (error) {
    return failure(error);
  }

  revalidateCatalogue();
  return { ok: true };
}

// --- prices -----------------------------------------------------------------

export async function addPriceAction(resourceId: string, raw: unknown): Promise<ActionResult> {
  const parsed = priceFormSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Periksa kembali isian formulir.',
      fieldErrors: fieldErrorsOf(parsed.error.issues),
    };
  }

  try {
    const user = await requireSessionUser();
    await setPrice(user, {
      resourceId,
      // Organisation default. Project overrides are set from the project's own
      // estimate screens, where the project is unambiguous.
      projectId: null,
      priceType: parsed.data.priceType,
      price: parsed.data.price,
      effectiveFrom: parsed.data.effectiveFrom,
      source: parsed.data.source,
      note: parsed.data.note,
    });
  } catch (error) {
    return failure(error);
  }

  revalidatePath(`/master-data/resources/${resourceId}`);
  revalidatePath('/master-data/resources');
  return { ok: true };
}

// --- units ------------------------------------------------------------------

export async function saveUnitAction(unitId: string | null, raw: unknown): Promise<ActionResult> {
  const parsed = unitFormSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Periksa kembali isian formulir.',
      fieldErrors: fieldErrorsOf(parsed.error.issues),
    };
  }

  try {
    const user = await requireSessionUser();
    if (unitId === null) await createUnit(user, parsed.data);
    else await updateUnit(user, unitId, parsed.data);
  } catch (error) {
    return failure(error);
  }

  revalidateCatalogue();
  return { ok: true };
}

export async function deleteUnitAction(unitId: string): Promise<ActionResult> {
  try {
    const user = await requireSessionUser();
    await deleteUnit(user, unitId);
  } catch (error) {
    return failure(error);
  }

  revalidateCatalogue();
  return { ok: true };
}

// --- suppliers --------------------------------------------------------------

export async function saveSupplierAction(
  supplierId: string | null,
  raw: unknown,
): Promise<ActionResult> {
  const parsed = supplierFormSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Periksa kembali isian formulir.',
      fieldErrors: fieldErrorsOf(parsed.error.issues),
    };
  }

  try {
    const user = await requireSessionUser();
    if (supplierId === null) await createSupplier(user, parsed.data);
    else await updateSupplier(user, supplierId, parsed.data);
  } catch (error) {
    return failure(error);
  }

  revalidateCatalogue();
  return { ok: true };
}

export async function deleteSupplierAction(supplierId: string): Promise<ActionResult> {
  try {
    const user = await requireSessionUser();
    await deleteSupplier(user, supplierId);
  } catch (error) {
    return failure(error);
  }

  revalidateCatalogue();
  return { ok: true };
}
