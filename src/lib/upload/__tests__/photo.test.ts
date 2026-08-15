import { describe, expect, it } from 'vitest';

import { MAX_PHOTO_BYTES, admitPhotos, formatBytes, validatePhoto } from '../photo';

const file = (over: Partial<{ name: string; type: string; size: number }> = {}) => ({
  name: 'IMG_0042.jpg',
  type: 'image/jpeg',
  size: 1024 * 1024,
  ...over,
});

describe('validatePhoto', () => {
  it('accepts what a phone camera produces', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']) {
      expect(validatePhoto(file({ type })).ok).toBe(true);
    }
  });

  it('rejects a document dressed as a photo', () => {
    const result = validatePhoto(file({ type: 'application/pdf' }));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/tidak didukung/);
  });

  it('names the missing type rather than showing an empty quote', () => {
    const result = validatePhoto(file({ type: '' }));
    expect(!result.ok && result.reason).toMatch(/tidak dikenal/);
  });

  it('rejects an empty file', () => {
    expect(validatePhoto(file({ size: 0 })).ok).toBe(false);
  });

  it('accepts a file exactly at the ceiling', () => {
    expect(validatePhoto(file({ size: MAX_PHOTO_BYTES })).ok).toBe(true);
  });

  it('rejects a file past the ceiling and states both numbers', () => {
    const result = validatePhoto(file({ size: MAX_PHOTO_BYTES + 1 }));
    expect(!result.ok && result.reason).toMatch(/8\.0 MB/);
  });
});

describe('formatBytes', () => {
  it('reads naturally at each scale', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(3.5 * 1024 * 1024)).toBe('3.5 MB');
  });
});

describe('admitPhotos', () => {
  it('accepts a clean batch', () => {
    const result = admitPhotos(0, [file({ name: 'a.jpg' }), file({ name: 'b.jpg' })]);
    expect(result.accepted).toHaveLength(2);
    expect(result.rejected).toEqual([]);
  });

  // Silently dropping half a selection leaves the user believing photos are
  // in the report that are not.
  it('reports a reason for every file it turns away', () => {
    const result = admitPhotos(0, [
      file({ name: 'ok.jpg' }),
      file({ name: 'notes.pdf', type: 'application/pdf' }),
      file({ name: 'huge.jpg', size: MAX_PHOTO_BYTES + 1 }),
    ]);

    expect(result.accepted.map((f) => f.name)).toEqual(['ok.jpg']);
    expect(result.rejected).toHaveLength(2);
  });

  it('stops at the limit and says so', () => {
    const batch = Array.from({ length: 4 }, (_, i) => file({ name: `${i}.jpg` }));
    const result = admitPhotos(0, batch, 2);

    expect(result.accepted).toHaveLength(2);
    expect(result.rejected).toHaveLength(2);
    expect(result.rejected[0]).toMatch(/maksimal 2 foto/);
  });

  it('counts what is already held against the limit', () => {
    const result = admitPhotos(9, [file({ name: 'a.jpg' }), file({ name: 'b.jpg' })]);
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
  });

  it('admits nothing once the limit is reached', () => {
    const result = admitPhotos(10, [file()]);
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toHaveLength(1);
  });

  it('handles an empty selection', () => {
    expect(admitPhotos(0, [])).toEqual({ accepted: [], rejected: [] });
  });
});
