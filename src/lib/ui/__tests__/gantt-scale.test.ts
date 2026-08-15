import { describe, expect, it } from 'vitest';

import { ganttScale, isLabelled } from '../gantt-scale';

describe('ganttScale', () => {
  // The case that was reported: 123 daily periods squeezed into one screen.
  it('stretches the track so a short task is still visible', () => {
    const { trackWidthPx } = ganttScale(123, 'DAY');

    expect(trackWidthPx).toBeGreaterThan(3000);

    // A four-day task inside 123 days, in real pixels.
    const barPx = (4 / 123) * trackWidthPx;
    expect(barPx).toBeGreaterThan(80);
  });

  it('keeps a small project from collapsing', () => {
    expect(ganttScale(3, 'MONTH').trackWidthPx).toBe(640);
    expect(ganttScale(1, 'WEEK').trackWidthPx).toBe(640);
  });

  it('gives coarser buckets more room each', () => {
    expect(ganttScale(20, 'MONTH').trackWidthPx).toBeGreaterThan(
      ganttScale(20, 'DAY').trackWidthPx,
    );
  });

  it('grows with the number of periods', () => {
    expect(ganttScale(200, 'DAY').trackWidthPx).toBeGreaterThan(ganttScale(100, 'DAY').trackWidthPx);
  });

  it('survives a project with no periods', () => {
    expect(ganttScale(0, 'DAY')).toEqual({ trackWidthPx: 640, labelStride: 1 });
  });

  describe('labelStride', () => {
    // Labels need about 76px; at 26px per day they would otherwise overlap.
    it('thins out daily labels', () => {
      expect(ganttScale(123, 'DAY').labelStride).toBeGreaterThanOrEqual(3);
    });

    it('labels every period when there is room', () => {
      expect(ganttScale(4, 'MONTH').labelStride).toBe(1);
      expect(ganttScale(8, 'WEEK').labelStride).toBe(1);
    });

    it('leaves each label at least its own width', () => {
      for (const count of [5, 30, 123, 400]) {
        const { trackWidthPx, labelStride } = ganttScale(count, 'DAY');
        const pxPerLabel = (trackWidthPx / count) * labelStride;
        expect(pxPerLabel).toBeGreaterThanOrEqual(76);
      }
    });

    it('never returns a stride below one', () => {
      for (const count of [0, 1, 2, 1000]) {
        expect(ganttScale(count, 'MONTH').labelStride).toBeGreaterThanOrEqual(1);
      }
    });
  });
});

describe('isLabelled', () => {
  it('always labels the first period', () => {
    expect(isLabelled(0, 5)).toBe(true);
  });

  it('labels every nth', () => {
    expect([0, 1, 2, 3, 4, 5, 6].filter((i) => isLabelled(i, 3))).toEqual([0, 3, 6]);
  });

  it('labels everything at stride one', () => {
    expect([0, 1, 2].every((i) => isLabelled(i, 1))).toBe(true);
  });
});
