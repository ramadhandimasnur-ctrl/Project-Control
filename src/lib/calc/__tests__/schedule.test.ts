import { describe, expect, it } from 'vitest';

import { toDecimal } from '../decimal';
import {
  MAX_PERIODS,
  barPosition,
  checkDistributions,
  distributeByDuration,
  durationBetween,
  finishFromDuration,
  generatePeriods,
  isPartialPeriod,
  normalizeToOne,
  overlapDays,
  plannedSCurve,
} from '../schedule';

const pct = (row: { plannedPct: { toString(): string } }) => row.plannedPct.toString();

describe('durationBetween', () => {
  // A task that starts and finishes on the same day lasts one day, not zero.
  it('counts inclusively', () => {
    expect(durationBetween('2026-08-15', '2026-08-15')).toBe(1);
    expect(durationBetween('2026-08-15', '2026-08-17')).toBe(3);
  });

  it('spans month and year boundaries', () => {
    expect(durationBetween('2026-01-30', '2026-02-02')).toBe(4);
    expect(durationBetween('2026-12-31', '2027-01-01')).toBe(2);
  });

  it('counts the leap day', () => {
    expect(durationBetween('2028-02-28', '2028-03-01')).toBe(3);
  });
});

describe('finishFromDuration', () => {
  it('is the inverse of durationBetween', () => {
    expect(finishFromDuration('2026-08-15', 3)).toBe('2026-08-17');
    expect(durationBetween('2026-08-15', finishFromDuration('2026-08-15', 10))).toBe(10);
  });

  it('rejects a duration below one day', () => {
    expect(() => finishFromDuration('2026-08-15', 0)).toThrow(/minimal 1 hari/);
  });
});

describe('generatePeriods', () => {
  it('buckets by day', () => {
    const periods = generatePeriods('2026-08-15', '2026-08-17', 'DAY');
    expect(periods).toHaveLength(3);
    expect(periods[0]).toMatchObject({ seq: 1, startDate: '2026-08-15', endDate: '2026-08-15' });
    expect(periods[2]).toMatchObject({ seq: 3, startDate: '2026-08-17', endDate: '2026-08-17' });
  });

  // 15 Aug 2026 is a Saturday, so the first week is a two-day stub.
  it('aligns weeks to the calendar and clips the first bucket', () => {
    const periods = generatePeriods('2026-08-15', '2026-09-06', 'WEEK');

    expect(periods[0]).toMatchObject({
      seq: 1,
      startDate: '2026-08-15',
      endDate: '2026-08-16',
      label: 'Minggu 1',
    });
    expect(periods[1]).toMatchObject({ startDate: '2026-08-17', endDate: '2026-08-23' });
    expect(periods.at(-1)).toMatchObject({ startDate: '2026-08-31', endDate: '2026-09-06' });
  });

  it('clips the last bucket to the project end', () => {
    const periods = generatePeriods('2026-08-17', '2026-08-26', 'WEEK');
    expect(periods.at(-1)).toMatchObject({ startDate: '2026-08-24', endDate: '2026-08-26' });
  });

  it('aligns months to the calendar', () => {
    const periods = generatePeriods('2026-08-15', '2026-10-10', 'MONTH');
    expect(periods.map((p) => [p.startDate, p.endDate])).toEqual([
      ['2026-08-15', '2026-08-31'],
      ['2026-09-01', '2026-09-30'],
      ['2026-10-01', '2026-10-10'],
    ]);
    expect(periods[1]?.label).toBe('September 2026');
  });

  it('covers the span with no gap and no overlap', () => {
    const periods = generatePeriods('2026-08-15', '2026-12-15', 'WEEK');

    expect(periods[0]?.startDate).toBe('2026-08-15');
    expect(periods.at(-1)?.endDate).toBe('2026-12-15');

    for (let i = 1; i < periods.length; i += 1) {
      const previousEnd = periods[i - 1]!.endDate;
      const currentStart = periods[i]!.startDate;
      expect(durationBetween(previousEnd, currentStart)).toBe(2); // adjacent days
    }
  });

  it('numbers periods from one, without gaps', () => {
    const periods = generatePeriods('2026-08-15', '2026-11-15', 'WEEK');
    expect(periods.map((p) => p.seq)).toEqual(periods.map((_, i) => i + 1));
  });

  it('handles a single-day project', () => {
    expect(generatePeriods('2026-08-15', '2026-08-15', 'MONTH')).toEqual([
      { seq: 1, startDate: '2026-08-15', endDate: '2026-08-15', label: 'Agustus 2026' },
    ]);
  });

  it('rejects an end date before the start', () => {
    expect(() => generatePeriods('2026-08-15', '2026-08-14', 'DAY')).toThrow(/mendahului/);
  });

  // Better than writing 1.826 rows nobody asked for.
  it('refuses a bucket that would produce too many periods', () => {
    expect(() => generatePeriods('2026-01-01', '2031-01-01', 'DAY')).toThrow(
      new RegExp(String(MAX_PERIODS)),
    );
  });
});

describe('isPartialPeriod', () => {
  it('flags a clipped opening week', () => {
    const periods = generatePeriods('2026-08-15', '2026-09-06', 'WEEK');
    expect(isPartialPeriod(periods[0]!, 'WEEK')).toBe(true);
    expect(isPartialPeriod(periods[1]!, 'WEEK')).toBe(false);
  });

  it('treats every day as whole', () => {
    const periods = generatePeriods('2026-08-15', '2026-08-16', 'DAY');
    expect(periods.every((p) => !isPartialPeriod(p, 'DAY'))).toBe(true);
  });
});

describe('overlapDays', () => {
  it('counts the shared days', () => {
    expect(overlapDays('2026-08-10', '2026-08-20', '2026-08-15', '2026-08-25')).toBe(6);
  });

  it('is zero when the ranges do not touch', () => {
    expect(overlapDays('2026-08-01', '2026-08-05', '2026-08-06', '2026-08-10')).toBe(0);
  });

  it('counts a single shared day', () => {
    expect(overlapDays('2026-08-01', '2026-08-06', '2026-08-06', '2026-08-10')).toBe(1);
  });
});

describe('distributeByDuration', () => {
  const periods = generatePeriods('2026-08-01', '2026-10-31', 'MONTH').map((p, i) => ({
    id: `p${i + 1}`,
    startDate: p.startDate,
    endDate: p.endDate,
  }));

  it('gives a single-period item all of it', () => {
    const rows = distributeByDuration(periods, '2026-08-05', '2026-08-20');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.periodId).toBe('p1');
    expect(pct(rows[0]!)).toBe('1');
  });

  it('splits in proportion to days in each period', () => {
    // 10 days in August, 30 in September.
    const rows = distributeByDuration(periods, '2026-08-22', '2026-09-30');
    expect(rows.map((r) => r.periodId)).toEqual(['p1', 'p2']);
    expect(toDecimal(pct(rows[0]!)).toFixed(4)).toBe('0.2500');
    expect(toDecimal(pct(rows[1]!)).toFixed(4)).toBe('0.7500');
  });

  it('always sums to exactly one', () => {
    for (const [start, finish] of [
      ['2026-08-01', '2026-10-31'],
      ['2026-08-15', '2026-09-15'],
      ['2026-09-02', '2026-10-03'],
      ['2026-08-01', '2026-08-01'],
    ] as const) {
      const rows = distributeByDuration(periods, start, finish);
      const total = rows.reduce((acc, r) => acc.plus(r.plannedPct), toDecimal(0));
      expect(total.toString()).toBe('1');
    }
  });

  it('skips periods the item never touches', () => {
    const rows = distributeByDuration(periods, '2026-10-01', '2026-10-31');
    expect(rows.map((r) => r.periodId)).toEqual(['p3']);
  });

  it('returns nothing when the item falls outside every period', () => {
    expect(distributeByDuration(periods, '2027-01-01', '2027-01-31')).toEqual([]);
  });

  it('rejects a finish before the start', () => {
    expect(() => distributeByDuration(periods, '2026-09-10', '2026-09-01')).toThrow(/mendahului/);
  });
});

describe('normalizeToOne', () => {
  // Three equal thirds round to 0,999999 and would fail the baseline check.
  it('puts the rounding remainder on the largest share', () => {
    const rows = normalizeToOne([
      { periodId: 'a', plannedPct: toDecimal(1).dividedBy(3) },
      { periodId: 'b', plannedPct: toDecimal(1).dividedBy(3) },
      { periodId: 'c', plannedPct: toDecimal(1).dividedBy(3) },
    ]);

    const total = rows.reduce((acc, r) => acc.plus(r.plannedPct), toDecimal(0));
    expect(total.toString()).toBe('1');
    expect(rows.map((r) => r.periodId)).toEqual(['a', 'b', 'c']);
  });

  it('leaves an already exact split alone', () => {
    const rows = normalizeToOne([
      { periodId: 'a', plannedPct: toDecimal('0.25') },
      { periodId: 'b', plannedPct: toDecimal('0.75') },
    ]);
    expect(rows.map(pct)).toEqual(['0.25', '0.75']);
  });

  it('handles an empty plan', () => {
    expect(normalizeToOne([])).toEqual([]);
  });
});

describe('checkDistributions', () => {
  it('accepts a plan that sums to one', () => {
    const result = checkDistributions(
      [
        { workItemId: 'w1', plannedPct: '0.4' },
        { workItemId: 'w1', plannedPct: '0.6' },
      ],
      ['w1'],
    );
    expect(result[0]).toMatchObject({ isComplete: true, isEmpty: false });
  });

  it('rejects a plan that falls short', () => {
    const result = checkDistributions([{ workItemId: 'w1', plannedPct: '0.9' }], ['w1']);
    expect(result[0]?.isComplete).toBe(false);
    expect(result[0]?.total.toString()).toBe('0.9');
  });

  it('rejects a plan that overshoots', () => {
    const result = checkDistributions(
      [
        { workItemId: 'w1', plannedPct: '0.7' },
        { workItemId: 'w1', plannedPct: '0.6' },
      ],
      ['w1'],
    );
    expect(result[0]?.isComplete).toBe(false);
  });

  // The column stores six decimals; exact equality would reject correct plans.
  it('tolerates rounding at the sixth decimal', () => {
    const result = checkDistributions(
      [
        { workItemId: 'w1', plannedPct: '0.333333' },
        { workItemId: 'w1', plannedPct: '0.333333' },
        { workItemId: 'w1', plannedPct: '0.333334' },
      ],
      ['w1'],
    );
    expect(result[0]?.isComplete).toBe(true);
  });

  it('reports an unscheduled item as empty, not as zero', () => {
    const result = checkDistributions([], ['w1']);
    expect(result[0]).toMatchObject({ isEmpty: true, isComplete: false });
  });

  it('reports every item asked about, in order', () => {
    const result = checkDistributions([{ workItemId: 'w2', plannedPct: '1' }], ['w1', 'w2', 'w3']);
    expect(result.map((r) => r.workItemId)).toEqual(['w1', 'w2', 'w3']);
    expect(result.map((r) => r.isComplete)).toEqual([false, true, false]);
  });
});

describe('plannedSCurve', () => {
  const periods = [
    { id: 'p1', seq: 1, label: 'Minggu 1' },
    { id: 'p2', seq: 2, label: 'Minggu 2' },
    { id: 'p3', seq: 3, label: 'Minggu 3' },
  ];

  it('accumulates weight times share', () => {
    const weights = new Map([
      ['w1', '0.6'],
      ['w2', '0.4'],
    ]);
    const curve = plannedSCurve(periods, weights, [
      { workItemId: 'w1', periodId: 'p1', plannedPct: '0.5' },
      { workItemId: 'w1', periodId: 'p2', plannedPct: '0.5' },
      { workItemId: 'w2', periodId: 'p2', plannedPct: '0.5' },
      { workItemId: 'w2', periodId: 'p3', plannedPct: '0.5' },
    ]);

    expect(curve.map((p) => p.plannedPct.toString())).toEqual(['0.3', '0.5', '0.2']);
    expect(curve.map((p) => p.cumulativePct.toString())).toEqual(['0.3', '0.8', '1']);
  });

  it('reaches exactly one when the plan is complete', () => {
    const weights = new Map([['w1', '1']]);
    const curve = plannedSCurve(periods, weights, [
      { workItemId: 'w1', periodId: 'p1', plannedPct: '0.333333' },
      { workItemId: 'w1', periodId: 'p2', plannedPct: '0.333333' },
      { workItemId: 'w1', periodId: 'p3', plannedPct: '0.333334' },
    ]);
    expect(curve.at(-1)?.cumulativePct.toString()).toBe('1');
  });

  it('holds the curve flat across a period with no work', () => {
    const curve = plannedSCurve(periods, new Map([['w1', '1']]), [
      { workItemId: 'w1', periodId: 'p1', plannedPct: '0.5' },
      { workItemId: 'w1', periodId: 'p3', plannedPct: '0.5' },
    ]);
    expect(curve.map((p) => p.cumulativePct.toString())).toEqual(['0.5', '0.5', '1']);
  });

  // Overhead lines carry cost but no progress weight.
  it('ignores work items that carry no weight', () => {
    const curve = plannedSCurve(periods, new Map([['w1', '1']]), [
      { workItemId: 'w1', periodId: 'p1', plannedPct: '1' },
      { workItemId: 'overhead', periodId: 'p2', plannedPct: '1' },
    ]);
    expect(curve.map((p) => p.cumulativePct.toString())).toEqual(['1', '1', '1']);
  });

  it('orders by seq regardless of input order', () => {
    const curve = plannedSCurve([periods[2]!, periods[0]!, periods[1]!], new Map([['w1', '1']]), [
      { workItemId: 'w1', periodId: 'p1', plannedPct: '1' },
    ]);
    expect(curve.map((p) => p.seq)).toEqual([1, 2, 3]);
    expect(curve[0]?.cumulativePct.toString()).toBe('1');
  });

  // A curve past 100% means the plan is wrong; clamping would hide it.
  it('does not clamp an overshooting plan', () => {
    const curve = plannedSCurve(periods, new Map([['w1', '1']]), [
      { workItemId: 'w1', periodId: 'p1', plannedPct: '0.8' },
      { workItemId: 'w1', periodId: 'p2', plannedPct: '0.8' },
    ]);
    expect(curve.at(-1)?.cumulativePct.toString()).toBe('1.6');
  });

  it('returns a flat zero curve for an empty plan', () => {
    const curve = plannedSCurve(periods, new Map(), []);
    expect(curve.map((p) => p.cumulativePct.toString())).toEqual(['0', '0', '0']);
  });
});

describe('barPosition', () => {
  const start = '2026-08-01';
  const end = '2026-08-10'; // ten days

  it('places a bar covering the whole timeline', () => {
    const bar = barPosition(start, end, start, end);
    expect(bar?.offsetPct.toString()).toBe('0');
    expect(bar?.widthPct.toString()).toBe('1');
  });

  it('offsets a bar starting midway', () => {
    const bar = barPosition(start, end, '2026-08-06', '2026-08-10');
    expect(bar?.offsetPct.toString()).toBe('0.5');
    expect(bar?.widthPct.toString()).toBe('0.5');
  });

  // A negative offset would slide the bar over the row labels.
  it('clips a bar that starts before the timeline', () => {
    const bar = barPosition(start, end, '2026-07-20', '2026-08-05');
    expect(bar?.offsetPct.toString()).toBe('0');
    expect(bar?.widthPct.toString()).toBe('0.5');
  });

  it('clips a bar that runs past the timeline', () => {
    const bar = barPosition(start, end, '2026-08-06', '2026-09-30');
    expect(bar?.offsetPct.toString()).toBe('0.5');
    expect(bar?.widthPct.toString()).toBe('0.5');
  });

  it('returns null for a bar entirely outside', () => {
    expect(barPosition(start, end, '2026-09-01', '2026-09-05')).toBeNull();
  });

  it('gives a one-day bar a real width', () => {
    const bar = barPosition(start, end, '2026-08-01', '2026-08-01');
    expect(bar?.widthPct.toString()).toBe('0.1');
  });
});
