import { describe, expect, it } from 'vitest';

import { toDecimal } from '../decimal';
import {
  lineRequirement,
  materialStatus,
  rankByShortage,
  rankByWastage,
  requirementForPeriod,
  requirementTotal,
  shortage,
  summariseMaterial,
  theoreticalUsage,
  totalShortageValue,
  wastage,
  wastagePercent,
  type RequirementLine,
} from '../material';

/** Charter section 8: two work items needing 500 kg and 700 kg of steel. */
const STEEL: RequirementLine[] = [
  { workItemId: 'A.01', volume: '500', coefRap: '1' },
  { workItemId: 'A.02', volume: '700', coefRap: '1' },
];

describe('requirement', () => {
  it('sums the demand of every work item', () => {
    expect(requirementTotal(STEEL).toString()).toBe('1200');
  });

  it('applies the waste factor to the requirement', () => {
    const line = { workItemId: 'A.01', volume: '100', coefRap: '8', wasteFactor: '0.05' };
    expect(lineRequirement(line).toString()).toBe('840');
  });

  it('is zero for a resource nothing needs', () => {
    expect(requirementTotal([]).toString()).toBe('0');
  });

  it('weights the requirement by what a period plans to build', () => {
    const planned = new Map([
      ['A.01', '0.5'],
      ['A.02', '0.25'],
    ]);
    // 500 x 0,5 + 700 x 0,25
    expect(requirementForPeriod(STEEL, planned).toString()).toBe('425');
  });

  it('treats a work item absent from the plan as contributing nothing', () => {
    expect(requirementForPeriod(STEEL, new Map([['A.01', '1']])).toString()).toBe('500');
  });
});

describe('stock and shortage — the charter walkthrough', () => {
  // Section 8: buy 100 → stock 100; issue 50 → stock 50; shortage 150.
  // Then buy 100 more → stock 150, shortage 50.
  it('follows the documented sequence', () => {
    const required = requirementTotal([{ workItemId: 'A.01', volume: '250', coefRap: '1' }]);
    expect(required.toString()).toBe('250');

    expect(shortage(required, '100').toString()).toBe('150');
    expect(shortage(required, '200').toString()).toBe('50');
  });

  it('never reports a negative shortage', () => {
    expect(shortage('1200', '1500').toString()).toBe('0');
  });
});

describe('wastage — the number Excel could not produce', () => {
  const lines: RequirementLine[] = [{ workItemId: 'A.01', volume: '100', coefRap: '8' }];

  it('is the gap between what left the store and what progress justifies', () => {
    // 40% complete, so 320 zak should have been used.
    const progress = new Map([['A.01', '0.4']]);
    expect(theoreticalUsage(lines, progress).toString()).toBe('320');

    expect(wastage('350', '320').toString()).toBe('30');
    expect(wastagePercent('350', '320')?.times(100).toFixed(4)).toBe('9.3750');
  });

  // Just as informative in reverse: work certified that the store has not
  // supplied usually means an issue was never recorded.
  it('reports a negative gap rather than clamping it', () => {
    expect(wastage('300', '320').toString()).toBe('-20');
  });

  it('returns null when nothing should have been used yet', () => {
    expect(wastagePercent('10', '0')).toBeNull();
  });

  it('counts a work item with no recorded progress as zero usage', () => {
    expect(theoreticalUsage(lines, new Map()).toString()).toBe('0');
  });
});

describe('materialStatus', () => {
  // Behind on buying: a purchasing problem.
  it('is RED when less has been bought than the plan needs by next period', () => {
    expect(
      materialStatus({
        purchased: '100',
        requirementToDateNextPeriod: '150',
        stock: '100',
        requirementNextPeriod: '50',
      }),
    ).toBe('RED');
  });

  // Bought enough but it is not on site: a delivery problem.
  it('is YELLOW when enough is bought but not enough is in stock', () => {
    expect(
      materialStatus({
        purchased: '200',
        requirementToDateNextPeriod: '150',
        stock: '30',
        requirementNextPeriod: '50',
      }),
    ).toBe('YELLOW');
  });

  it('is GREEN when both are covered', () => {
    expect(
      materialStatus({
        purchased: '200',
        requirementToDateNextPeriod: '150',
        stock: '80',
        requirementNextPeriod: '50',
      }),
    ).toBe('GREEN');
  });

  // RED outranks YELLOW: not having bought it is the worse problem.
  it('reports RED even when stock is also short', () => {
    expect(
      materialStatus({
        purchased: '10',
        requirementToDateNextPeriod: '150',
        stock: '0',
        requirementNextPeriod: '50',
      }),
    ).toBe('RED');
  });
});

describe('summariseMaterial', () => {
  const base = {
    lines: [{ workItemId: 'A.01', volume: '100', coefRap: '8' }] as RequirementLine[],
    purchased: '900',
    issued: '350',
    stock: '550',
    cumulativePctByWorkItem: new Map([['A.01', '0.4']]),
    movingAverageCost: '15850',
  };

  it('produces every figure the requirement table shows', () => {
    const summary = summariseMaterial(base);

    expect(summary.requirementTotal.toString()).toBe('800');
    expect(summary.theoreticalUsage.toString()).toBe('320');
    expect(summary.wastage.toString()).toBe('30');
    expect(summary.shortage.toString()).toBe('0');
    expect(summary.stockValue?.toFixed(2)).toBe('8717500.00');
    expect(summary.status).toBe('GREEN');
  });

  it('values the remaining purchase at the actual cost when there is one', () => {
    const summary = summariseMaterial({ ...base, purchased: '500' });
    expect(summary.shortage.toString()).toBe('300');
    expect(summary.purchaseValueRemaining?.toFixed(2)).toBe('4755000.00');
  });

  // Nothing bought yet, so there is no actual cost to value against.
  it('falls back to the planned price before anything is bought', () => {
    const summary = summariseMaterial({
      ...base,
      purchased: '0',
      stock: '0',
      movingAverageCost: null,
      priceRap: '15500',
    });
    expect(summary.purchaseValueRemaining?.toFixed(2)).toBe('12400000.00');
  });

  it('reports no value at all when neither price is known', () => {
    const summary = summariseMaterial({
      ...base,
      movingAverageCost: null,
      priceRap: null,
    });
    expect(summary.stockValue).toBeNull();
    expect(summary.purchaseValueRemaining).toBeNull();
  });
});

describe('ranking helpers', () => {
  const rows = [
    { code: 'a', shortage: toDecimal('10'), wastage: toDecimal('-5') },
    { code: 'b', shortage: toDecimal('200'), wastage: toDecimal('40') },
    { code: 'c', shortage: toDecimal('0'), wastage: toDecimal('15') },
  ];

  it('ranks the biggest shortage first', () => {
    expect(rankByShortage(rows).map((r) => r.code)).toEqual(['b', 'a', 'c']);
  });

  // A negative gap is an unrecorded issue, not waste; it does not belong on a
  // list of things being wasted.
  it('ranks wastage and excludes under-issued resources', () => {
    expect(rankByWastage(rows).map((r) => r.code)).toEqual(['b', 'c']);
  });

  it('does not mutate the input', () => {
    const order = rows.map((r) => r.code);
    rankByShortage(rows);
    expect(rows.map((r) => r.code)).toEqual(order);
  });
});

describe('totalShortageValue', () => {
  it('adds up the money still to be spent', () => {
    expect(
      totalShortageValue([
        { purchaseValueRemaining: toDecimal('4755000') },
        { purchaseValueRemaining: toDecimal('1200000') },
      ]).toFixed(2),
    ).toBe('5955000.00');
  });

  // An unpriced resource is left out rather than guessed at, so the result is
  // a floor — the caller has to know that.
  it('skips rows with no known price', () => {
    expect(
      totalShortageValue([
        { purchaseValueRemaining: toDecimal('1000') },
        { purchaseValueRemaining: null },
      ]).toString(),
    ).toBe('1000');
  });

  it('is zero for an empty list', () => {
    expect(totalShortageValue([]).toString()).toBe('0');
  });
});
