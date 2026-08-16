/**
 * Shrinks a photograph in the browser before it is uploaded.
 *
 * A phone photograph is routinely 4–12 MB and 4000 px wide. Nothing in a site
 * report needs that: the plates print four to a page, and the report renderer
 * has to decode every one of them when the print dialog opens. Compressing
 * first makes the upload finish on a site connection and keeps the bucket from
 * filling with detail no one will ever look at.
 *
 * The geometry is pure and tested; the encoding needs a canvas and therefore a
 * browser.
 */

/** Long edge after resizing. Enough for an A4 plate at print resolution. */
export const MAX_EDGE_PX = 1600;

/** JPEG quality. Above this the file grows fast for detail a print loses. */
export const JPEG_QUALITY = 0.82;

/** Below this a photograph is passed through untouched. */
export const SKIP_BELOW_BYTES = 300 * 1024;

export type Dimensions = { width: number; height: number };

/**
 * Dimensions after fitting inside a square of `maxEdge`, preserving aspect.
 *
 * Never enlarges: a small photograph scaled up gains bytes and no detail.
 * Rounds to whole pixels and floors at 1, because a canvas of zero width
 * throws rather than producing an empty image.
 */
export function fitWithin(source: Dimensions, maxEdge: number = MAX_EDGE_PX): Dimensions {
  const { width, height } = source;
  if (width <= 0 || height <= 0) return { width: 1, height: 1 };

  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width: Math.round(width), height: Math.round(height) };

  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** True when a file is small enough that re-encoding would only lose quality. */
export function shouldSkipCompression(bytes: number, type: string): boolean {
  // PNG is left alone at any size: it is what signatures arrive as, and
  // re-encoding one to JPEG replaces its transparency with a white box.
  if (type === 'image/png') return true;
  return bytes <= SKIP_BELOW_BYTES;
}

/** Name the stored object will carry, always with the extension it ends up as. */
export function compressedName(original: string): string {
  const base = original.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9._-]+/g, '-');
  return `${base || 'foto'}.jpg`;
}

export type CompressionResult = {
  file: File;
  originalBytes: number;
  compressedBytes: number;
};

/**
 * Resizes and re-encodes a photograph to JPEG.
 *
 * Returns the original untouched when it is already small, when it is a PNG,
 * or when anything in the pipeline fails — a photograph that will not compress
 * is still worth keeping, and refusing the upload over it would lose the
 * evidence the user came to record.
 */
export async function compressPhoto(file: File): Promise<CompressionResult> {
  const unchanged: CompressionResult = {
    file,
    originalBytes: file.size,
    compressedBytes: file.size,
  };

  if (shouldSkipCompression(file.size, file.type)) return unchanged;
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') return unchanged;

  try {
    const bitmap = await createImageBitmap(file);
    const target = fitWithin({ width: bitmap.width, height: bitmap.height });

    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;

    const context = canvas.getContext('2d');
    if (!context) {
      bitmap.close();
      return unchanged;
    }

    context.drawImage(bitmap, 0, 0, target.width, target.height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY);
    });

    if (!blob || blob.size === 0) return unchanged;

    // A re-encode that grew the file is a worse copy of the same picture.
    if (blob.size >= file.size) return unchanged;

    return {
      file: new File([blob], compressedName(file.name), {
        type: 'image/jpeg',
        lastModified: file.lastModified,
      }),
      originalBytes: file.size,
      compressedBytes: blob.size,
    };
  } catch {
    return unchanged;
  }
}
