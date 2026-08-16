import 'server-only';

import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import { db } from '@/db';
import { withUser } from '@/db/context';
import { projectSignatories } from '@/db/schema';
import { conflict, notFound, validation } from '@/lib/errors';
import { SIGNATORY_SLOTS, type SignatorySlot } from '@/lib/reports/signatories';
import { DOCUMENT_BUCKET, supabaseAdmin } from '@/lib/supabase/admin';

import { assertProjectAccess } from './access';
import { writeAuditLog } from './audit';
import { type SessionUser } from './session';

/**
 * Who signs the project's printed reports.
 *
 * Held per project rather than per report: the same three people sign every
 * sheet for months, and retyping them per report is how a name ends up spelled
 * two ways across a stack of documents handed to the same client.
 *
 * The signature image is optional throughout. A site that signs on paper wants
 * a clean empty box above a printed name, and a system that insists on an
 * upload before it will print is a system people stop using.
 */

/** Signature URLs live as long as a print session plausibly does. */
const SIGNATURE_URL_TTL_SECONDS = 60 * 60;

export type SignatoryRow = {
  slot: SignatorySlot;
  name: string;
  position: string;
  signaturePath: string | null;
  /** Short-lived; null when absent or unsignable. */
  signatureUrl: string | null;
};

/**
 * All three slots, always, in printing order.
 *
 * Slots with no row come back empty rather than missing, so the printed sheet
 * always has three columns — an unfilled one is a box waiting for a wet
 * signature, not a layout that silently collapses to two.
 */
export async function listSignatories(
  userId: string,
  projectId: string,
): Promise<SignatoryRow[]> {
  await assertProjectAccess(userId, projectId, 'VIEWER');

  const rows = await db
    .select({
      slot: projectSignatories.slot,
      name: projectSignatories.name,
      position: projectSignatories.position,
      signaturePath: projectSignatories.signaturePath,
    })
    .from(projectSignatories)
    .where(eq(projectSignatories.projectId, projectId));

  const bySlot = new Map(rows.map((row) => [row.slot, row]));

  const paths = rows
    .map((row) => row.signaturePath)
    .filter((path): path is string => path !== null);

  const urlByPath = new Map<string, string>();
  if (paths.length > 0) {
    const { data } = await supabaseAdmin()
      .storage.from(DOCUMENT_BUCKET)
      .createSignedUrls(paths, SIGNATURE_URL_TTL_SECONDS);

    for (const signed of data ?? []) {
      if (signed.signedUrl && signed.path) urlByPath.set(signed.path, signed.signedUrl);
    }
  }

  return SIGNATORY_SLOTS.map((slot) => {
    const row = bySlot.get(slot);
    return {
      slot,
      name: row?.name ?? '',
      position: row?.position ?? '',
      signaturePath: row?.signaturePath ?? null,
      signatureUrl: row?.signaturePath ? (urlByPath.get(row.signaturePath) ?? null) : null,
    };
  });
}

export type SignatoryInput = {
  slot: SignatorySlot;
  name: string;
  position: string;
  /** Undefined leaves the current image alone; null removes it. */
  signaturePath?: string | null;
};

/**
 * Saves one column's signatory.
 *
 * Gated at project manager: these names appear under "approved by" on a
 * document that leaves the organisation, and who is named there is not an
 * engineering detail.
 */
export async function saveSignatory(
  user: SessionUser,
  projectId: string,
  input: SignatoryInput,
): Promise<void> {
  const access = await assertProjectAccess(user.id, projectId, 'PROJECT_MANAGER');

  const name = input.name.trim();
  const position = input.position.trim();

  if (name === '') throw validation('Nama terang wajib diisi.');
  if (position === '') throw validation('Jabatan wajib diisi.');

  if (input.signaturePath !== undefined && input.signaturePath !== null) {
    if (!input.signaturePath.startsWith(`${projectId}/signatures/`)) {
      throw validation('Jalur berkas tanda tangan tidak sesuai dengan proyek ini.');
    }
  }

  const [existing] = await db
    .select({ id: projectSignatories.id, signaturePath: projectSignatories.signaturePath })
    .from(projectSignatories)
    .where(
      and(
        eq(projectSignatories.projectId, projectId),
        eq(projectSignatories.slot, input.slot),
      ),
    )
    .limit(1);

  /*
   * Replacing an image removes the old object. A signature left behind in the
   * bucket is somebody's signature sitting in storage with nothing pointing at
   * it and no reason to still exist.
   */
  const supersededPath =
    input.signaturePath !== undefined &&
    existing?.signaturePath &&
    existing.signaturePath !== input.signaturePath
      ? existing.signaturePath
      : null;

  await withUser(user.id, async (tx) => {
    await tx
      .insert(projectSignatories)
      .values({
        projectId,
        slot: input.slot,
        name,
        position,
        signaturePath: input.signaturePath ?? null,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .onConflictDoUpdate({
        target: [projectSignatories.projectId, projectSignatories.slot],
        set: {
          name,
          position,
          ...(input.signaturePath === undefined ? {} : { signaturePath: input.signaturePath }),
          updatedBy: user.id,
        },
      });

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'project_signatories',
      recordId: existing?.id ?? null,
      action: existing ? 'UPDATE' : 'INSERT',
      after: { slot: input.slot, name, position, hasSignature: Boolean(input.signaturePath) },
      actorId: user.id,
    });
  });

  if (supersededPath) {
    await supabaseAdmin().storage.from(DOCUMENT_BUCKET).remove([supersededPath]);
  }
}

/** Authorises one signature upload and reserves its path. */
export async function createSignatureUploadTarget(
  user: SessionUser,
  projectId: string,
  slot: SignatorySlot,
): Promise<{ path: string; token: string }> {
  await assertProjectAccess(user.id, projectId, 'PROJECT_MANAGER');

  if (!SIGNATORY_SLOTS.includes(slot)) throw notFound('Kolom pengesahan tidak dikenal.');

  // Always PNG: transparency is what makes a signature sit on the line rather
  // than in a white box, and the uploader refuses anything else.
  const path = `${projectId}/signatures/${slot}-${randomUUID()}.png`;

  const { data, error } = await supabaseAdmin()
    .storage.from(DOCUMENT_BUCKET)
    .createSignedUploadUrl(path);

  if (error || !data) {
    throw conflict(
      'Tidak dapat menyiapkan unggahan tanda tangan.',
      error?.message ?? 'Periksa konfigurasi Supabase Storage.',
    );
  }

  return { path: data.path, token: data.token };
}

/** Removes a signature image, leaving the name and position in place. */
export async function clearSignature(
  user: SessionUser,
  projectId: string,
  slot: SignatorySlot,
): Promise<void> {
  await assertProjectAccess(user.id, projectId, 'PROJECT_MANAGER');

  const [existing] = await db
    .select({ signaturePath: projectSignatories.signaturePath })
    .from(projectSignatories)
    .where(
      and(eq(projectSignatories.projectId, projectId), eq(projectSignatories.slot, slot)),
    )
    .limit(1);

  if (!existing?.signaturePath) return;

  await withUser(user.id, (tx) =>
    tx
      .update(projectSignatories)
      .set({ signaturePath: null, updatedBy: user.id })
      .where(
        and(eq(projectSignatories.projectId, projectId), eq(projectSignatories.slot, slot)),
      ),
  );

  await supabaseAdmin().storage.from(DOCUMENT_BUCKET).remove([existing.signaturePath]);
}
