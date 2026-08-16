import 'server-only';

import { randomUUID } from 'node:crypto';

import { and, asc, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { withUser } from '@/db/context';
import { progressDocuments, schedulePeriods, workItems } from '@/db/schema';
import { conflict, notFound, validation } from '@/lib/errors';
import { DOCUMENT_BUCKET, supabaseAdmin } from '@/lib/supabase/admin';

import { assertProjectAccess } from './access';
import { writeAuditLog } from './audit';
import { type SessionUser } from './session';

/**
 * Site photographs that outlive the browser tab.
 *
 * Files go straight from the browser to storage through a single-use signed
 * URL this module mints; they never pass through the Next server, which has a
 * body limit measured in megabytes and no reason to hold a photograph in
 * memory. The row recording where a file landed is written afterwards, so a
 * failed upload leaves no phantom entry pointing at nothing.
 *
 * Reading works the other way: the bucket is private, so every render mints
 * short-lived signed URLs. A link copied out of the page stops working within
 * the hour rather than becoming a permanent public address for a client's
 * site photographs.
 */

/** How long a render's image URLs stay valid. */
const READ_URL_TTL_SECONDS = 60 * 60;

export type DocumentRow = {
  id: string;
  workItemId: string | null;
  caption: string | null;
  byteSize: number | null;
  storagePath: string;
  createdAt: string;
  /** Short-lived; regenerated on every render. */
  url: string | null;
};

/** Everything attached to one period, newest last so plates read in order. */
export async function listPeriodDocuments(
  userId: string,
  projectId: string,
  periodId: string,
): Promise<DocumentRow[]> {
  await assertProjectAccess(userId, projectId, 'VIEWER');

  const rows = await db
    .select({
      id: progressDocuments.id,
      workItemId: progressDocuments.workItemId,
      caption: progressDocuments.caption,
      byteSize: progressDocuments.byteSize,
      storagePath: progressDocuments.storagePath,
      createdAt: progressDocuments.createdAt,
    })
    .from(progressDocuments)
    .where(
      and(
        eq(progressDocuments.projectId, projectId),
        eq(progressDocuments.periodId, periodId),
      ),
    )
    .orderBy(asc(progressDocuments.createdAt));

  if (rows.length === 0) return [];

  /*
   * One round trip for the whole page rather than one per photograph. A period
   * with thirty plates would otherwise open thirty connections to mint URLs
   * that all expire together anyway.
   */
  const { data, error } = await supabaseAdmin()
    .storage.from(DOCUMENT_BUCKET)
    .createSignedUrls(
      rows.map((row) => row.storagePath),
      READ_URL_TTL_SECONDS,
    );

  const urlByPath = new Map<string, string>();
  if (!error && data) {
    for (const signed of data) {
      if (signed.signedUrl && signed.path) urlByPath.set(signed.path, signed.signedUrl);
    }
  }

  return rows.map((row) => ({
    id: row.id,
    workItemId: row.workItemId,
    caption: row.caption,
    byteSize: row.byteSize,
    storagePath: row.storagePath,
    createdAt: row.createdAt.toISOString(),
    // Null when storage could not sign it — the plate renders a placeholder
    // rather than a broken image with no explanation.
    url: urlByPath.get(row.storagePath) ?? null,
  }));
}

export type UploadTarget = {
  /** Where the object will live; echoed back when recording the row. */
  path: string;
  /** Single-use upload token from Supabase Storage. */
  token: string;
};

/**
 * Authorises one upload and reserves a path for it.
 *
 * The path carries project, period and a random id — never the original file
 * name, which on a phone is routinely the same for every photograph and would
 * collide across users. Recording the row is a separate call, so a browser
 * that dies mid-upload leaves an orphan object rather than a row that promises
 * a photograph nobody can fetch.
 */
export async function createUploadTarget(
  user: SessionUser,
  projectId: string,
  periodId: string,
  extension: string,
): Promise<UploadTarget> {
  await assertProjectAccess(user.id, projectId, 'FIELD_USER');
  await assertPeriodBelongs(projectId, periodId);

  const safeExtension = /^[a-z0-9]{1,5}$/i.test(extension) ? extension.toLowerCase() : 'jpg';
  const path = `${projectId}/${periodId}/${randomUUID()}.${safeExtension}`;

  const { data, error } = await supabaseAdmin()
    .storage.from(DOCUMENT_BUCKET)
    .createSignedUploadUrl(path);

  if (error || !data) {
    throw conflict(
      'Tidak dapat menyiapkan unggahan foto.',
      error?.message ?? 'Periksa konfigurasi Supabase Storage.',
    );
  }

  return { path: data.path, token: data.token };
}

/**
 * Records a file the browser has finished uploading.
 *
 * The path is re-derived from the project and period rather than trusted as
 * given: a caller that sent someone else's path would otherwise attach another
 * project's photograph to this report.
 */
export async function recordDocument(
  user: SessionUser,
  input: {
    projectId: string;
    periodId: string;
    workItemId: string | null;
    storagePath: string;
    caption: string | null;
    byteSize: number | null;
  },
): Promise<{ id: string }> {
  const access = await assertProjectAccess(user.id, input.projectId, 'FIELD_USER');
  await assertPeriodBelongs(input.projectId, input.periodId);

  if (!input.storagePath.startsWith(`${input.projectId}/${input.periodId}/`)) {
    throw validation('Jalur berkas tidak sesuai dengan proyek dan periode ini.');
  }

  if (input.workItemId !== null) {
    const [item] = await db
      .select({ id: workItems.id })
      .from(workItems)
      .where(and(eq(workItems.id, input.workItemId), eq(workItems.projectId, input.projectId)))
      .limit(1);

    if (!item) throw notFound('Pekerjaan tidak ditemukan pada proyek ini.');
  }

  return withUser(user.id, async (tx) => {
    const [created] = await tx
      .insert(progressDocuments)
      .values({
        projectId: input.projectId,
        periodId: input.periodId,
        workItemId: input.workItemId,
        storagePath: input.storagePath,
        caption: input.caption?.trim() || null,
        byteSize: input.byteSize,
        uploadedBy: user.id,
      })
      .returning({ id: progressDocuments.id });

    if (!created) throw conflict('Foto gagal dicatat.');

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId: input.projectId,
      tableName: 'progress_documents',
      recordId: created.id,
      action: 'INSERT',
      after: { periodId: input.periodId, workItemId: input.workItemId, path: input.storagePath },
      actorId: user.id,
    });

    return { id: created.id };
  });
}

/** Renames a photograph without touching the stored object. */
export async function setDocumentCaption(
  user: SessionUser,
  projectId: string,
  documentId: string,
  caption: string,
): Promise<void> {
  await assertProjectAccess(user.id, projectId, 'FIELD_USER');
  const trimmed = caption.trim();

  await withUser(user.id, (tx) =>
    tx
      .update(progressDocuments)
      .set({ caption: trimmed === '' ? null : trimmed })
      .where(
        and(eq(progressDocuments.id, documentId), eq(progressDocuments.projectId, projectId)),
      ),
  );
}

/**
 * Removes a photograph from the report and from storage.
 *
 * The row goes first. An object left behind is wasted space; a row left behind
 * is a plate that renders as a broken image on a printed report, which is the
 * worse of the two failures.
 */
export async function deleteDocument(
  user: SessionUser,
  projectId: string,
  documentId: string,
): Promise<void> {
  const access = await assertProjectAccess(user.id, projectId, 'FIELD_USER');

  const [row] = await db
    .select({ id: progressDocuments.id, storagePath: progressDocuments.storagePath })
    .from(progressDocuments)
    .where(and(eq(progressDocuments.id, documentId), eq(progressDocuments.projectId, projectId)))
    .limit(1);

  if (!row) throw notFound('Foto tidak ditemukan.');

  await withUser(user.id, async (tx) => {
    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'progress_documents',
      recordId: documentId,
      action: 'DELETE',
      before: { path: row.storagePath },
      actorId: user.id,
    });

    await tx.delete(progressDocuments).where(eq(progressDocuments.id, documentId));
  });

  await supabaseAdmin().storage.from(DOCUMENT_BUCKET).remove([row.storagePath]);
}

async function assertPeriodBelongs(projectId: string, periodId: string): Promise<void> {
  const [period] = await db
    .select({ id: schedulePeriods.id })
    .from(schedulePeriods)
    .where(and(eq(schedulePeriods.id, periodId), eq(schedulePeriods.projectId, projectId)))
    .limit(1);

  if (!period) throw validation('Periode tidak dikenal pada proyek ini.');
}

/** Photographs attached to the report as a whole, not to any work item. */
export async function listGeneralDocuments(
  userId: string,
  projectId: string,
  periodId: string,
): Promise<DocumentRow[]> {
  const all = await listPeriodDocuments(userId, projectId, periodId);
  return all.filter((row) => row.workItemId === null);
}

/** Used by the integrity check in tests; not part of the page flow. */
export async function countDocuments(projectId: string, periodId: string): Promise<number> {
  const rows = await db
    .select({ id: progressDocuments.id })
    .from(progressDocuments)
    .where(
      and(
        eq(progressDocuments.projectId, projectId),
        eq(progressDocuments.periodId, periodId),
        isNull(progressDocuments.workItemId),
      ),
    );
  return rows.length;
}
