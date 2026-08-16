import { describe, expect, it } from 'vitest';

import {
  actualSCurve,
  compareCurves,
  completionByItem,
  deriveProgress,
  deviationStatus,
  progressFromMilestones,
  remainingFor,
  schedulePerformanceIndex,
  weightedProgress,
} from '../progress';

const THRESHOLDS = { warning: '-0.005', delayed: '-0.05' };

describe('deriveProgress', () => {
  it('turns a quantity into its share of the volume', () => {
    const result = deriveProgress({ method: 'VOLUME', qtyThisPeriod: '25' }, '100');
    expect(result.qtyThisPeriod.toString()).toBe('25');
    expect(result.pctThisPeriod.toString()).toBe('0.25');
  });

  it('turns a share into its quantity', () => {
    const result = deriveProgress({ method: 'PERCENT', pctThisPeriod: '0.4' }, '250');
    expect(result.qtyThisPeriod.toString()).toBe('100');
    expect(result.pctThisPeriod.toString()).toBe('0.4');
  });

  it('treats milestone progress as a share, like percent', () => {
    const result = deriveProgress({ method: 'MILESTONE', pctThisPeriod: '0.75' }, '8');
    expect(result.qtyThisPeriod.toString()).toBe('6');
  });

  // Overshooting the estimated volume is legitimate; claiming 115% done is not.
  it('caps the share at 100% even when the quantity exceeds the volume', () => {
    const result = deriveProgress({ method: 'VOLUME', qtyThisPeriod: '115' }, '100');
    expect(result.qtyThisPeriod.toString()).toBe('115');
    expect(result.pctThisPeriod.toString()).toBe('1');
  });

  // Inventing a percentage here would be a fabricated number.
  it('reports zero share for a work item with no volume', () => {
    const result = deriveProgress({ method: 'VOLUME', qtyThisPeriod: '10' }, '0');
    expect(result.pctThisPeriod.toString()).toBe('0');
  });

  it('treats a missing value as nothing done', () => {
    expect(deriveProgress({ method: 'VOLUME' }, '100').pctThisPeriod.toString()).toBe('0');
    expect(deriveProgress({ method: 'PERCENT', pctThisPeriod: null }, '100').qtyThisPeriod.toString()).toBe('0');
  });

  it('rounds the quantity to its stored scale', () => {
    const result = deriveProgress({ method: 'PERCENT', pctThisPeriod: '0.333333' }, '3');
    expect(result.qtyThisPeriod.toString()).toBe('1');
  });
});

describe('progressFromMilestones', () => {
  const milestones = [
    { id: 'a', weight: '0.3' },
    { id: 'b', weight: '0.5' },
    { id: 'c', weight: '0.2' },
  ];

  it('sums the weights of the completed ones', () => {
    expect(progressFromMilestones(milestones, ['a', 'c']).toString()).toBe('0.5');
  });

  it('is zero when nothing is ticked', () => {
    expect(progressFromMilestones(milestones, []).toString()).toBe('0');
  });

  it('reaches one when everything is ticked', () => {
    expect(progressFromMilestones(milestones, ['a', 'b', 'c']).toString()).toBe('1');
  });

  // A half-specified checklist should report what it covers, not be scaled up.
  it('does not scale up a checklist whose weights fall short of one', () => {
    expect(progressFromMilestones([{ id: 'a', weight: '0.4' }], ['a']).toString()).toBe('0.4');
  });

  it('ignores ids that are not milestones', () => {
    expect(progressFromMilestones(milestones, ['a', 'ghost']).toString()).toBe('0.3');
  });
});

describe('completionByItem', () => {
  it('accumulates the periods of each item', () => {
    const result = completionByItem(
      [
        { workItemId: 'w1', periodId: 'p1', pctThisPeriod: '0.3' },
        { workItemId: 'w1', periodId: 'p2', pctThisPeriod: '0.4' },
        { workItemId: 'w2', periodId: 'p1', pctThisPeriod: '1' },
      ],
      ['w1', 'w2'],
    );

    expect(result[0]?.completion.toString()).toBe('0.7');
    expect(result[1]?.completion.toString()).toBe('1');
  });

  it('reports an unreported item as zero', () => {
    expect(completionByItem([], ['w1'])[0]?.completion.toString()).toBe('0');
  });

  it('caps at one but says that it had to', () => {
    const result = completionByItem(
      [
        { workItemId: 'w1', periodId: 'p1', pctThisPeriod: '0.8' },
        { workItemId: 'w1', periodId: 'p2', pctThisPeriod: '0.5' },
      ],
      ['w1'],
    );
    expect(result[0]?.completion.toString()).toBe('1');
    expect(result[0]?.overshoots).toBe(true);
  });

  it('does not flag an exact hundred as overshooting', () => {
    const result = completionByItem(
      [{ workItemId: 'w1', periodId: 'p1', pctThisPeriod: '1' }],
      ['w1'],
    );
    expect(result[0]?.overshoots).toBe(false);
  });
});

describe('remainingFor', () => {
  const entries = [
    { workItemId: 'w1', periodId: 'p1', pctThisPeriod: '0.3' },
    { workItemId: 'w1', periodId: 'p2', pctThisPeriod: '0.4' },
    { workItemId: 'w2', periodId: 'p1', pctThisPeriod: '0.9' },
  ];

  it('is what is left of the item', () => {
    expect(remainingFor(entries, 'w1', null).toString()).toBe('0.3');
  });

  // Editing an existing entry must not count that entry against itself.
  it('excludes the period being edited', () => {
    expect(remainingFor(entries, 'w1', 'p2').toString()).toBe('0.7');
  });

  it('is the whole item when nothing was reported', () => {
    expect(remainingFor([], 'w9', null).toString()).toBe('1');
  });

  it('never goes negative', () => {
    const over = [
      { workItemId: 'w1', periodId: 'p1', pctThisPeriod: '0.8' },
      { workItemId: 'w1', periodId: 'p2', pctThisPeriod: '0.5' },
    ];
    expect(remainingFor(over, 'w1', null).toString()).toBe('0');
  });
});

describe('weightedProgress', () => {
  it('scales each column by the item weight', () => {
    const result = weightedProgress('0.25', '0.4', '0.2', '0.7');
    expect(result.previous.toString()).toBe('0.1');
    expect(result.current.toString()).toBe('0.05');
    expect(result.cumulative.toString()).toBe('0.15');
    expect(result.planned.toString()).toBe('0.175');
  });

  it('reports the gap against plan, negative when behind', () => {
    const behind = weightedProgress('0.25', '0.4', '0.2', '0.7');
    expect(behind.deviation.toString()).toBe('-0.025');

    const ahead = weightedProgress('0.25', '0.4', '0.4', '0.7');
    expect(ahead.deviation.toString()).toBe('0.025');
  });

  /*
   * The whole reason these are weighted: a reader adds the column down the
   * page and lands on the project's progress. Item percentages cannot do that.
   */
  it('sums across items to the project progress', () => {
    const items = [
      weightedProgress('0.5', '0.4', '0.2', '0.6'),
      weightedProgress('0.3', '1', '0', '1'),
      weightedProgress('0.2', '0', '0.5', '0.4'),
    ];

    const total = items.reduce((acc, item) => acc.plus(item.cumulative), items[0]!.cumulative.times(0));
    expect(total.toString()).toBe('0.7');
  });

  it('never lets one item contribute more than its weight', () => {
    const result = weightedProgress('0.25', '0.8', '0.5', '1');
    expect(result.cumulative.toString()).toBe('0.25');
  });

  it('contributes nothing when the item carries no weight', () => {
    const result = weightedProgress('0', '1', '1', '1');
    expect(result.cumulative.toString()).toBe('0');
    expect(result.deviation.toString()).toBe('0');
  });
});

describe('actualSCurve', () => {
  const periods = [
    { id: 'p1', seq: 1, label: 'M1' },
    { id: 'p2', seq: 2, label: 'M2' },
    { id: 'p3', seq: 3, label: 'M3' },
  ];
  const weights = new Map([
    ['w1', '0.25'],
    ['w2', '0.75'],
  ]);

  it('weights each report by its work item', () => {
    const curve = actualSCurve(periods, weights, [
      { workItemId: 'w1', periodId: 'p1', pctThisPeriod: '1' },
      { workItemId: 'w2', periodId: 'p2', pctThisPeriod: '0.5' },
    ]);

    expect(curve.map((p) => p.cumulativePct.toString())).toEqual(['0.25', '0.625', '0.625']);
  });

  // A curve that stops is indistinguishable from one that has stalled.
  it('carries the last value across unreported periods', () => {
    const curve = actualSCurve(periods, weights, [
      { workItemId: 'w1', periodId: 'p1', pctThisPeriod: '1' },
    ]);
    expect(curve).toHaveLength(3);
    expect(curve.at(-1)?.cumulativePct.toString()).toBe('0.25');
  });

  it('ignores work items with no progress weight', () => {
    const curve = actualSCurve(periods, weights, [
      { workItemId: 'overhead', periodId: 'p1', pctThisPeriod: '1' },
    ]);
    expect(curve.every((p) => p.cumulativePct.isZero())).toBe(true);
  });

  it('orders by seq regardless of input order', () => {
    const curve = actualSCurve([periods[2]!, periods[0]!, periods[1]!], weights, [
      { workItemId: 'w1', periodId: 'p1', pctThisPeriod: '1' },
    ]);
    expect(curve.map((p) => p.seq)).toEqual([1, 2, 3]);
  });

  it('is a flat zero when nothing is approved', () => {
    const curve = actualSCurve(periods, weights, []);
    expect(curve.every((p) => p.cumulativePct.isZero())).toBe(true);
  });
});

describe('deviationStatus', () => {
  it('calls a project ahead when it beats the plan', () => {
    const { deviation, status } = deviationStatus('0.4', '0.45', THRESHOLDS);
    expect(deviation.toString()).toBe('0.05');
    expect(status).toBe('AHEAD');
  });

  it('calls an exact match on track', () => {
    expect(deviationStatus('0.4', '0.4', THRESHOLDS).status).toBe('ON_TRACK');
  });

  it('tolerates a slip inside the warning threshold', () => {
    expect(deviationStatus('0.4', '0.397', THRESHOLDS).status).toBe('ON_TRACK');
  });

  it('warns past the first threshold', () => {
    expect(deviationStatus('0.4', '0.38', THRESHOLDS).status).toBe('WARNING');
  });

  it('calls it delayed past the second', () => {
    expect(deviationStatus('0.4', '0.3', THRESHOLDS).status).toBe('DELAYED');
  });

  // Exactly on a threshold is not yet past it.
  it('treats a boundary as the kinder side', () => {
    expect(deviationStatus('0.4', '0.395', THRESHOLDS).status).toBe('ON_TRACK');
    expect(deviationStatus('0.4', '0.35', THRESHOLDS).status).toBe('WARNING');
  });

  // Half a percent behind means different things on different jobs.
  it('honours project-specific thresholds', () => {
    const strict = { warning: '-0.001', delayed: '-0.002' };
    expect(deviationStatus('0.4', '0.397', strict).status).toBe('DELAYED');
  });
});

describe('schedulePerformanceIndex', () => {
  it('is realised over planned', () => {
    expect(schedulePerformanceIndex('0.5', '0.4')?.toString()).toBe('0.8');
  });

  // Dividing by a plan of zero would report day one as infinitely ahead.
  it('is unknown before the plan expects anything', () => {
    expect(schedulePerformanceIndex('0', '0')).toBeNull();
    expect(schedulePerformanceIndex('0', '0.1')).toBeNull();
  });
});

describe('compareCurves', () => {
  const planned = [
    { periodId: 'p1', seq: 1, label: 'M1', cumulativePct: '0.2' },
    { periodId: 'p2', seq: 2, label: 'M2', cumulativePct: '0.6' },
    { periodId: 'p3', seq: 3, label: 'M3', cumulativePct: '1' },
  ];

  it('pairs each period with what actually happened', () => {
    const result = compareCurves(
      planned,
      [
        { periodId: 'p1', cumulativePct: '0.2' },
        { periodId: 'p2', cumulativePct: '0.5' },
      ],
      THRESHOLDS,
      2,
    );

    expect(result[0]?.status).toBe('ON_TRACK');
    expect(result[1]?.deviation.toString()).toBe('-0.1');
    expect(result[1]?.status).toBe('DELAYED');
  });

  // A period that has not arrived is not a failure.
  it('leaves SPI unknown beyond the last reported period', () => {
    const result = compareCurves(planned, [{ periodId: 'p1', cumulativePct: '0.2' }], THRESHOLDS, 1);
    expect(result[0]?.spi?.toString()).toBe('1');
    expect(result[1]?.spi).toBeNull();
    expect(result[2]?.spi).toBeNull();
  });

  it('reports nothing as reported when nothing has been', () => {
    const result = compareCurves(planned, [], THRESHOLDS, null);
    expect(result.every((p) => p.spi === null)).toBe(true);
    expect(result[2]?.deviation.toString()).toBe('-1');
  });

  it('keeps the planned curve as the spine', () => {
    const result = compareCurves(planned, [{ periodId: 'ghost', cumulativePct: '9' }], THRESHOLDS, 1);
    expect(result.map((p) => p.periodId)).toEqual(['p1', 'p2', 'p3']);
    expect(result[0]?.actualCumulative.toString()).toBe('0');
  });

  it('sorts by seq', () => {
    const result = compareCurves([planned[2]!, planned[0]!, planned[1]!], [], THRESHOLDS, null);
    expect(result.map((p) => p.seq)).toEqual([1, 2, 3]);
  });
});
