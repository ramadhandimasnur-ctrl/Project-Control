import { describe, expect, it } from 'vitest';

import {
  MAX_EDGE_PX,
  SKIP_BELOW_BYTES,
  compressedName,
  fitWithin,
  shouldSkipCompression,
} from '../compress';

describe('fitWithin', () => {
  it('leaves a photograph that already fits alone', () => {
    expect(fitWithin({ width: 800, height: 600 })).toEqual({ width: 800, height: 600 });
  });

  it('scales the long edge down and keeps the aspect ratio', () => {
    const result = fitWithin({ width: 4000, height: 3000 });
    expect(result.width).toBe(MAX_EDGE_PX);
    expect(result.height).toBe(1200);
  });

  it('works the same on a portrait photograph', () => {
    const result = fitWithin({ width: 3000, height: 4000 });
    expect(result.height).toBe(MAX_EDGE_PX);
    expect(result.width).toBe(1200);
  });

  /*
   * Enlarging gains bytes and no detail — the pixels being invented were never
   * photographed.
   */
  it('never enlarges', () => {
    expect(fitWithin({ width: 100, height: 50 }, 2000)).toEqual({ width: 100, height: 50 });
  });

  // A canvas of zero width throws rather than producing an empty image.
  it('never returns a zero dimension', () => {
    expect(fitWithin({ width: 10000, height: 1 })).toEqual({ width: MAX_EDGE_PX, height: 1 });
    expect(fitWithin({ width: 0, height: 0 })).toEqual({ width: 1, height: 1 });
  });
});

describe('shouldSkipCompression', () => {
  it('passes a small photograph through untouched', () => {
    expect(shouldSkipCompression(SKIP_BELOW_BYTES - 1, 'image/jpeg')).toBe(true);
  });

  it('compresses anything above the threshold', () => {
    expect(shouldSkipCompression(SKIP_BELOW_BYTES + 1, 'image/jpeg')).toBe(false);
  });

  /*
   * Re-encoding a PNG to JPEG replaces its transparency with a white box,
   * which is exactly wrong for a signature.
   */
  it('never re-encodes a PNG, however large', () => {
    expect(shouldSkipCompression(5 * 1024 * 1024, 'image/png')).toBe(true);
  });
});

describe('compressedName', () => {
  it('renames to the extension the file actually ends up as', () => {
    expect(compressedName('IMG_20260816.HEIC')).toBe('IMG_20260816.jpg');
  });

  it('strips characters a storage path should not carry', () => {
    expect(compressedName('foto lapangan (1).jpeg')).toBe('foto-lapangan-1-.jpg');
  });

  it('falls back to a usable name', () => {
    expect(compressedName('.jpeg')).toBe('foto.jpg');
  });
});
