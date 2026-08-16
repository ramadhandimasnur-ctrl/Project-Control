import 'server-only';

import { and, asc, count, eq, inArray } from 'drizzle-orm';

import { db } from '@/db';
import { withUser } from '@/db/context';
import {
  ahspTemplateResources,
  ahspTemplates,
  resources,
  units,
  workItemResources,
  workItems,
} from '@/db/schema';
import { conflict, notFound, validation } from '@/lib/errors';

import { assertProjectAccess } from './access';
import { writeAuditLog } from './audit';
import { assertOrgAccess } from './org-access';
import { type SessionUser } from './session';

export type TemplateRow = {
  id: string;
  code: string;
  name: string;
  unitCode: string;
  notes: string | null;
  lineCount: number;
};

export async function listTemplates(userId: string): Promise<TemplateRow[]> {
  const access = await assertOrgAccess(userId);

  const lines = db.$with('template_lines').as(
    db
      .select({ templateId: ahspTemplateResources.templateId, total: count().as('total') })
      .from(ahspTemplateResources)
      .groupBy(ahspTemplateResources.templateId),
  );

  const rows = await db
    .with(lines)
    .select({
      id: ahspTemplates.id,
      code: ahspTemplates.code,
      name: ahspTemplates.name,
      unitCode: units.code,
      notes: ahspTemplates.notes,
      lineCount: lines.total,
    })
    .from(ahspTemplates)
    .innerJoin(units, eq(units.id, ahspTemplates.unitId))
    .leftJoin(lines, eq(lines.templateId, ahspTemplates.id))
    .where(eq(ahspTemplates.orgId, access.orgId))
    .orderBy(asc(ahspTemplates.code));

  return rows.map((r) => ({ ...r, lineCount: r.lineCount ?? 0 }));
}

/**
 * Freezes a work item's analysis into a reusable template.
 *
 * A snapshot, not a link: editing the work item afterwards leaves the template
 * alone, and vice versa. A template that silently changed under the projects
 * built from it would make old estimates unexplainable.
 */
export async function saveTemplateFromWorkItem(
  user: SessionUser,
  projectId: string,
  workItemId: string,
  input: { code: string; name: string; notes?: string | null },
): Promise<{ id: string }> {
  const access = await assertProjectAccess(user.id, projectId, 'ENGINEER');

  const [item] = await db
    .select({ id: workItems.id, unitId: workItems.unitId, name: workItems.name })
    .from(workItems)
    .where(and(eq(workItems.id, workItemId), eq(workItems.projectId, projectId)))
    .limit(1);

  if (!item) throw notFound('Pekerjaan tidak ditemukan.');

  const lines = await db
    .select({
      resourceId: workItemResources.resourceId,
      role: workItemResources.role,
      estimateType: workItemResources.estimateType,
      coef: workItemResources.coef,
      wasteFactor: workItemResources.wasteFactor,
    })
    .from(workItemResources)
    .where(eq(workItemResources.workItemId, workItemId));

  if (lines.length === 0) {
    throw validation(
      `"${item.name}" belum memiliki baris analisa, sehingga tidak ada yang dapat disimpan sebagai template.`,
      'Susun analisanya terlebih dahulu.',
    );
  }

  const [duplicate] = await db
    .select({ id: ahspTemplates.id, name: ahspTemplates.name })
    .from(ahspTemplates)
    .where(and(eq(ahspTemplates.orgId, access.orgId), eq(ahspTemplates.code, input.code)))
    .limit(1);

  if (duplicate) {
    throw conflict(`Kode template "${input.code}" sudah dipakai oleh "${duplicate.name}".`);
  }

  return withUser(user.id, async (tx) => {
    const [created] = await tx
      .insert(ahspTemplates)
      .values({
        orgId: access.orgId,
        code: input.code,
        name: input.name,
        unitId: item.unitId,
        notes: input.notes ?? null,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning({ id: ahspTemplates.id });

    if (!created) throw conflict('Template gagal dibuat.');

    await tx.insert(ahspTemplateResources).values(
      lines.map((line) => ({
        templateId: created.id,
        resourceId: line.resourceId,
        role: line.role,
        estimateType: line.estimateType,
        coef: line.coef,
        wasteFactor: line.wasteFactor,
        createdBy: user.id,
        updatedBy: user.id,
      })),
    );

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'ahsp_templates',
      recordId: created.id,
      action: 'INSERT',
      after: { ...input, sourceWorkItemId: workItemId, lineCount: lines.length },
      actorId: user.id,
    });

    return { id: created.id };
  });
}

export type ApplyMode = 'REPLACE' | 'APPEND';

export type ApplyTemplateResult = {
  added: number;
  skipped: number;
  removed: number;
};

/**
 * Copies a template's lines onto a work item.
 *
 * REPLACE clears the existing analysis first. APPEND keeps it and skips any
 * resource already present in the same section, rather than failing on the
 * unique constraint half way through — a partially applied template is worse
 * than one that reports what it left alone.
 */
export async function applyTemplate(
  user: SessionUser,
  projectId: string,
  workItemId: string,
  templateId: string,
  mode: ApplyMode = 'APPEND',
): Promise<ApplyTemplateResult> {
  const access = await assertProjectAccess(user.id, projectId, 'ENGINEER');

  const [template] = await db
    .select({ id: ahspTemplates.id, name: ahspTemplates.name })
    .from(ahspTemplates)
    .where(and(eq(ahspTemplates.id, templateId), eq(ahspTemplates.orgId, access.orgId)))
    .limit(1);

  if (!template) throw notFound('Template tidak ditemukan.');

  const [item] = await db
    .select({ id: workItems.id })
    .from(workItems)
    .where(and(eq(workItems.id, workItemId), eq(workItems.projectId, projectId)))
    .limit(1);

  if (!item) throw notFound('Pekerjaan tidak ditemukan.');

  const templateLines = await db
    .select({
      resourceId: ahspTemplateResources.resourceId,
      role: ahspTemplateResources.role,
      estimateType: ahspTemplateResources.estimateType,
      coef: ahspTemplateResources.coef,
      wasteFactor: ahspTemplateResources.wasteFactor,
    })
    .from(ahspTemplateResources)
    .where(eq(ahspTemplateResources.templateId, templateId));

  if (templateLines.length === 0) {
    throw validation(`Template "${template.name}" tidak memiliki baris analisa.`);
  }

  return withUser(user.id, async (tx) => {
    let removed = 0;

    if (mode === 'REPLACE') {
      const existing = await tx
        .select({ id: workItemResources.id })
        .from(workItemResources)
        .where(eq(workItemResources.workItemId, workItemId));
      removed = existing.length;

      if (removed > 0) {
        await tx.delete(workItemResources).where(eq(workItemResources.workItemId, workItemId));
      }
    }

    const present = new Set(
      (
        await tx
          .select({ resourceId: workItemResources.resourceId, role: workItemResources.role })
          .from(workItemResources)
          .where(eq(workItemResources.workItemId, workItemId))
      ).map((r) => `${r.resourceId}|${r.role}`),
    );

    const toInsert = templateLines.filter((l) => !present.has(`${l.resourceId}|${l.role}`));
    const skipped = templateLines.length - toInsert.length;

    if (toInsert.length > 0) {
      await tx.insert(workItemResources).values(
        toInsert.map((line, index) => ({
          workItemId,
          resourceId: line.resourceId,
          role: line.role,
          estimateType: line.estimateType,
          coef: line.coef,
          wasteFactor: line.wasteFactor,
          sortOrder: index,
          createdBy: user.id,
          updatedBy: user.id,
        })),
      );
    }

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'work_item_resources',
      recordId: workItemId,
      action: 'INSERT',
      after: { templateId, mode, added: toInsert.length, skipped, removed },
      actorId: user.id,
    });

    return { added: toInsert.length, skipped, removed };
  });
}

export async function deleteTemplate(user: SessionUser, templateId: string): Promise<void> {
  const access = await assertOrgAccess(user.id, 'ADMIN');

  const [before] = await db
    .select()
    .from(ahspTemplates)
    .where(and(eq(ahspTemplates.id, templateId), eq(ahspTemplates.orgId, access.orgId)))
    .limit(1);

  if (!before) throw notFound('Template tidak ditemukan.');

  await withUser(user.id, async (tx) => {
    await writeAuditLog(tx, {
      orgId: access.orgId,
      tableName: 'ahsp_templates',
      recordId: templateId,
      action: 'DELETE',
      before,
      actorId: user.id,
    });
    // Template lines cascade; work items built from it are untouched, because
    // applying a template copies rather than links.
    await tx.delete(ahspTemplates).where(eq(ahspTemplates.id, templateId));
  });
}

/** Resources referenced by a template, for the preview before applying. */
export async function getTemplateLines(userId: string, templateId: string) {
  const access = await assertOrgAccess(userId);

  const [template] = await db
    .select({ id: ahspTemplates.id })
    .from(ahspTemplates)
    .where(and(eq(ahspTemplates.id, templateId), eq(ahspTemplates.orgId, access.orgId)))
    .limit(1);

  if (!template) throw notFound('Template tidak ditemukan.');

  return db
    .select({
      resourceCode: resources.code,
      resourceName: resources.name,
      unitCode: units.code,
      role: ahspTemplateResources.role,
      estimateType: ahspTemplateResources.estimateType,
      coef: ahspTemplateResources.coef,
      wasteFactor: ahspTemplateResources.wasteFactor,
    })
    .from(ahspTemplateResources)
    .innerJoin(resources, eq(resources.id, ahspTemplateResources.resourceId))
    .innerJoin(units, eq(units.id, resources.unitId))
    .where(eq(ahspTemplateResources.templateId, templateId))
    .orderBy(asc(ahspTemplateResources.role), asc(resources.code));
}

/** Templates whose resources all exist and are active — safe to apply. */
export async function listApplicableTemplates(userId: string): Promise<TemplateRow[]> {
  const templates = await listTemplates(userId);
  if (templates.length === 0) return [];

  const inactive = await db
    .select({ templateId: ahspTemplateResources.templateId })
    .from(ahspTemplateResources)
    .innerJoin(resources, eq(resources.id, ahspTemplateResources.resourceId))
    .where(
      and(
        inArray(
          ahspTemplateResources.templateId,
          templates.map((t) => t.id),
        ),
        eq(resources.isActive, false),
      ),
    );

  const blocked = new Set(inactive.map((r) => r.templateId));
  return templates.filter((t) => !blocked.has(t.id) && t.lineCount > 0);
}
