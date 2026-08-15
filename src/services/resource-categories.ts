import 'server-only';

import { and, asc, count, eq } from 'drizzle-orm';

import { db } from '@/db';
import { withUser } from '@/db/context';
import { resourceCategories, resources } from '@/db/schema';
import { conflict, notFound, validation } from '@/lib/errors';
import { buildCategoryTree, type TreeNode } from '@/lib/master-data/category-tree';

import { assertOrgAccess } from './org-access';
import { writeAuditLog } from './audit';
import { type ResourceType } from './resources';
import { type SessionUser } from './session';

export type CategoryRow = {
  id: string;
  code: string;
  name: string;
  type: ResourceType;
  parentId: string | null;
  resourceCount: number;
};

export type CategoryNode = TreeNode<CategoryRow>;

/** Re-exported so callers need only one import for the category view. */
export { buildCategoryTree };

export async function listCategories(userId: string): Promise<CategoryRow[]> {
  const access = await assertOrgAccess(userId);

  const usage = db.$with('category_usage').as(
    db
      .select({ categoryId: resources.categoryId, total: count().as('total') })
      .from(resources)
      .groupBy(resources.categoryId),
  );

  const rows = await db
    .with(usage)
    .select({
      id: resourceCategories.id,
      code: resourceCategories.code,
      name: resourceCategories.name,
      type: resourceCategories.type,
      parentId: resourceCategories.parentId,
      resourceCount: usage.total,
    })
    .from(resourceCategories)
    .leftJoin(usage, eq(usage.categoryId, resourceCategories.id))
    .where(eq(resourceCategories.orgId, access.orgId))
    .orderBy(asc(resourceCategories.code));

  return rows.map((r) => ({ ...r, resourceCount: r.resourceCount ?? 0 }));
}

export type CategoryInput = {
  code: string;
  name: string;
  type: ResourceType;
  parentId?: string | null;
};

export async function createCategory(
  user: SessionUser,
  input: CategoryInput,
): Promise<{ id: string }> {
  const access = await assertOrgAccess(user.id, 'ADMIN');
  await assertCodeAvailable(access.orgId, input.code, null);
  if (input.parentId) await requireCategory(access.orgId, input.parentId);

  return withUser(user.id, async (tx) => {
    const [created] = await tx
      .insert(resourceCategories)
      .values({
        orgId: access.orgId,
        code: input.code,
        name: input.name,
        type: input.type,
        parentId: input.parentId ?? null,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning({ id: resourceCategories.id });

    if (!created) throw conflict('Kategori gagal dibuat.');

    await writeAuditLog(tx, {
      orgId: access.orgId,
      tableName: 'resource_categories',
      recordId: created.id,
      action: 'INSERT',
      after: input,
      actorId: user.id,
    });

    return { id: created.id };
  });
}

export async function updateCategory(
  user: SessionUser,
  categoryId: string,
  input: CategoryInput,
): Promise<void> {
  const access = await assertOrgAccess(user.id, 'ADMIN');
  const before = await requireCategory(access.orgId, categoryId);

  if (before.code !== input.code) {
    await assertCodeAvailable(access.orgId, input.code, categoryId);
  }

  if (input.parentId) {
    if (input.parentId === categoryId) {
      throw validation('Kategori tidak dapat menjadi induk bagi dirinya sendiri.');
    }
    await requireCategory(access.orgId, input.parentId);
    await assertNoCycle(access.orgId, categoryId, input.parentId);
  }

  await withUser(user.id, async (tx) => {
    await tx
      .update(resourceCategories)
      .set({
        code: input.code,
        name: input.name,
        type: input.type,
        parentId: input.parentId ?? null,
        updatedBy: user.id,
      })
      .where(eq(resourceCategories.id, categoryId));

    await writeAuditLog(tx, {
      orgId: access.orgId,
      tableName: 'resource_categories',
      recordId: categoryId,
      action: 'UPDATE',
      before,
      after: input,
      actorId: user.id,
    });
  });
}

export async function deleteCategory(user: SessionUser, categoryId: string): Promise<void> {
  const access = await assertOrgAccess(user.id, 'ADMIN');
  const before = await requireCategory(access.orgId, categoryId);

  const [used] = await db
    .select({ value: count() })
    .from(resources)
    .where(eq(resources.categoryId, categoryId));

  if ((used?.value ?? 0) > 0) {
    throw conflict(
      `Kategori "${before.name}" tidak dapat dihapus karena berisi ${used?.value} sumber daya.`,
      'Pindahkan sumber daya tersebut ke kategori lain terlebih dahulu.',
    );
  }

  const [children] = await db
    .select({ value: count() })
    .from(resourceCategories)
    .where(eq(resourceCategories.parentId, categoryId));

  if ((children?.value ?? 0) > 0) {
    throw conflict(
      `Kategori "${before.name}" masih memiliki ${children?.value} sub-kategori.`,
      'Hapus atau pindahkan sub-kategorinya terlebih dahulu.',
    );
  }

  await withUser(user.id, async (tx) => {
    await writeAuditLog(tx, {
      orgId: access.orgId,
      tableName: 'resource_categories',
      recordId: categoryId,
      action: 'DELETE',
      before,
      actorId: user.id,
    });
    await tx.delete(resourceCategories).where(eq(resourceCategories.id, categoryId));
  });
}

async function requireCategory(orgId: string, categoryId: string) {
  const [row] = await db
    .select()
    .from(resourceCategories)
    .where(and(eq(resourceCategories.id, categoryId), eq(resourceCategories.orgId, orgId)))
    .limit(1);

  if (!row) throw notFound('Kategori tidak ditemukan.');
  return row;
}

async function assertCodeAvailable(
  orgId: string,
  code: string,
  exceptId: string | null,
): Promise<void> {
  const [existing] = await db
    .select({ id: resourceCategories.id })
    .from(resourceCategories)
    .where(and(eq(resourceCategories.orgId, orgId), eq(resourceCategories.code, code)))
    .limit(1);

  if (existing && existing.id !== exceptId) {
    throw conflict(`Kode kategori "${code}" sudah dipakai.`);
  }
}

/** Walks up from the proposed parent; meeting the node itself means a loop. */
async function assertNoCycle(
  orgId: string,
  categoryId: string,
  proposedParentId: string,
): Promise<void> {
  let cursor: string | null = proposedParentId;

  for (let depth = 0; cursor !== null && depth < 32; depth += 1) {
    if (cursor === categoryId) {
      throw validation(
        'Perubahan ini membuat kategori menjadi induk dari dirinya sendiri.',
        'Pilih induk lain yang bukan turunan kategori ini.',
      );
    }
    const parent = await requireCategory(orgId, cursor);
    cursor = parent.parentId;
  }
}
