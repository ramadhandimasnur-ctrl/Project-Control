/**
 * What counts as an acceptable site photograph.
 *
 * Photographs are never uploaded. They are held in the browser as object URLs
 * and printed straight into the report, so nothing here protects a server —
 * the limits exist because the browser has to decode and rasterise every one
 * of them when the print dialog opens, and twenty untouched phone photos will
 * stall that long enough to look like a crash.
 *
 * Pure and dependency-free so the same rules can be tested directly.
 */

/** Formats a phone camera actually produces, plus the ones browsers convert to. */
export const ALLOWED_PHOTO_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
] as const;

/** Ceiling per photograph, for the print renderer's sake. */
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

/** Photographs per inspection. Enough to cover a pour from several angles. */
export const MAX_PHOTOS_PER_ITEM = 10;

export type PhotoCandidate = { name: string; type: string; size: number };

export type PhotoRejection = { ok: false; reason: string };
export type PhotoAcceptance = { ok: true };

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function validatePhoto(file: PhotoCandidate): PhotoAcceptance | PhotoRejection {
  if (file.size === 0) {
    return { ok: false, reason: `Berkas "${file.name}" kosong.` };
  }

  if (!(ALLOWED_PHOTO_TYPES as readonly string[]).includes(file.type)) {
    return {
      ok: false,
      reason: `Format "${file.type || 'tidak dikenal'}" tidak didukung. Gunakan JPG, PNG, WebP, atau HEIC.`,
    };
  }

  if (file.size > MAX_PHOTO_BYTES) {
    return {
      ok: false,
      reason: `Ukuran ${formatBytes(file.size)} melebihi batas ${formatBytes(MAX_PHOTO_BYTES)}.`,
    };
  }

  return { ok: true };
}

/**
 * Decides which of a batch of files may be added, given what is already held.
 *
 * Returns both sides: the accepted files and a sentence per rejection. A picker
 * that silently drops half a selection leaves the user believing photographs
 * are in the report that are not.
 */
export function admitPhotos<T extends PhotoCandidate>(
  existingCount: number,
  incoming: readonly T[],
  limit: number = MAX_PHOTOS_PER_ITEM,
): { accepted: T[]; rejected: string[] } {
  const accepted: T[] = [];
  const rejected: string[] = [];
  let room = limit - existingCount;

  for (const file of incoming) {
    if (room <= 0) {
      rejected.push(`"${file.name}" dilewati: maksimal ${limit} foto.`);
      continue;
    }

    const verdict = validatePhoto(file);
    if (verdict.ok) {
      accepted.push(file);
      room -= 1;
    } else {
      rejected.push(verdict.reason);
    }
  }

  return { accepted, rejected };
}
