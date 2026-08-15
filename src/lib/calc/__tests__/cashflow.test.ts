import { describe, expect, it } from 'vitest';

import {
  cashflowByPeriod,
  claimBreakdown,
  costVariance,
  deficitWarnings,
  peakFunding,
  projectedMargin,
  type CashRow,
} from '../cashflow';

const periods = [
  { id: 'p1', seq: 1, label: 'M1' },
  { id: 'p2', seq: 2, label: 'M2' },
  { id: 'p3', seq: 3, label: 'M3' },
];

const row = (over: Partial<CashRow> & Pick<CashRow, 'periodId'>): CashRow => ({
  direction: 'OUT',
  category: 'MATERIAL',
  amount: '1000000',
  ...over,
});

describe('cashflowByPeriod', () => {
  it('nets inflow against outflow', () => {
    const flow = cashflowByPeriod(periods, [
      row({ periodId: 'p1', direction: 'IN', category: 'DOWN_PAYMENT', amount: '5000000' }),
      row({ periodId: 'p1', amount: '2000000' }),
    ]);

    expect(flow[0]?.inflow.toString()).toBe('5000000');
    expect(flow[0]?.outflow.toString()).toBe('2000000');
    expect(flow[0]?.net.toString()).toBe('3000000');
  });

  // A project does not start each month with a fresh purse.
  it('carries the closing balance into the next period', () => {
    const flow = cashflowByPeriod(periods, [
      row({ periodId: 'p1', direction: 'IN', category: 'TERMIN', amount: '5000000' }),
      row({ periodId: 'p2', amount: '3000000' }),
    ]);

    expect(flow[0]?.closing.toString()).toBe('5000000');
    expect(flow[1]?.opening.toString()).toBe('5000000');
    expect(flow[1]?.closing.toString()).toBe('2000000');
    expect(flow[2]?.closing.toString()).toBe('2000000');
  });

  it('starts from the opening balance', () => {
    const flow = cashflowByPeriod(periods, [], '1500000');
    expect(flow[0]?.opening.toString()).toBe('1500000');
    expect(flow.at(-1)?.closing.toString()).toBe('1500000');
  });

  it('splits outflow by category', () => {
    const flow = cashflowByPeriod(periods, [
      row({ periodId: 'p1', category: 'MATERIAL', amount: '2000000' }),
      row({ periodId: 'p1', category: 'LABOR', amount: '800000' }),
      row({ periodId: 'p1', category: 'MATERIAL', amount: '500000' }),
    ]);

    expect(flow[0]?.byCategory.MATERIAL?.toString()).toBe('2500000');
    expect(flow[0]?.byCategory.LABOR?.toString()).toBe('800000');
  });

  it('marks a period that ends in the red', () => {
    const flow = cashflowByPeriod(periods, [row({ periodId: 'p1', amount: '1000000' })]);
    expect(flow[0]?.isDeficit).toBe(true);
    expect(flow[0]?.closing.toString()).toBe('-1000000');
  });

  it('does not call a zero balance a deficit', () => {
    const flow = cashflowByPeriod(periods, [
      row({ periodId: 'p1', direction: 'IN', category: 'TERMIN', amount: '1000000' }),
      row({ periodId: 'p1', amount: '1000000' }),
    ]);
    expect(flow[0]?.isDeficit).toBe(false);
  });

  // Folding stray rows into the first period would silently move money in time.
  it('ignores rows belonging to no known period', () => {
    const flow = cashflowByPeriod(periods, [row({ periodId: 'ghost', amount: '9000000' })]);
    expect(flow.every((p) => p.outflow.isZero())).toBe(true);
  });

  it('orders by seq regardless of input order', () => {
    const flow = cashflowByPeriod([periods[2]!, periods[0]!, periods[1]!], [
      row({ periodId: 'p1', direction: 'IN', category: 'TERMIN', amount: '100' }),
    ]);
    expect(flow.map((p) => p.seq)).toEqual([1, 2, 3]);
    expect(flow[0]?.closing.toString()).toBe('100');
  });

  it('returns a flat line when nothing has moved', () => {
    const flow = cashflowByPeriod(periods, []);
    expect(flow).toHaveLength(3);
    expect(flow.every((p) => p.net.isZero() && !p.isDeficit)).toBe(true);
  });
});

describe('deficitWarnings', () => {
  const flow = cashflowByPeriod(periods, [
    row({ periodId: 'p1', amount: '3000000' }),
    row({ periodId: 'p2', direction: 'IN', category: 'TERMIN', amount: '10000000' }),
    row({ periodId: 'p3', amount: '9000000' }),
  ]);

  // "Raise 3.000.000" beats "balance is -3.000.000" under pressure.
  it('reports the shortfall as a positive number', () => {
    const warnings = deficitWarnings(flow);
    expect(warnings[0]?.shortfall.toString()).toBe('3000000');
  });

  it('names the period so it can be acted on', () => {
    expect(deficitWarnings(flow)[0]).toMatchObject({ periodId: 'p1', label: 'M1' });
  });

  it('is empty for a project that stays solvent', () => {
    expect(deficitWarnings(cashflowByPeriod(periods, [], '5000000'))).toEqual([]);
  });
});

describe('peakFunding', () => {
  it('finds the worst point, which is what sizes the facility', () => {
    const flow = cashflowByPeriod(periods, [
      row({ periodId: 'p1', amount: '2000000' }),
      row({ periodId: 'p2', amount: '5000000' }),
      row({ periodId: 'p3', direction: 'IN', category: 'TERMIN', amount: '6000000' }),
    ]);

    expect(peakFunding(flow)?.shortfall.toString()).toBe('7000000');
    expect(peakFunding(flow)?.label).toBe('M2');
  });

  it('is null when the project never dips', () => {
    expect(peakFunding(cashflowByPeriod(periods, [], '1'))).toBeNull();
  });
});

describe('claimBreakdown', () => {
  const base = {
    contractValue: '1000000000',
    retentionPercent: '0.05',
    vatPercent: '0.11',
    whtPercent: '0.02',
  };

  it('bills the increment, not the cumulative figure', () => {
    const result = claimBreakdown({
      ...base,
      certifiedProgressPct: '0.3',
      previouslyCertifiedPct: '0.1',
    });
    // 20% of a milliard, not 30%.
    expect(result.grossAmount.toString()).toBe('200000000');
  });

  it('treats the first claim as billing from zero', () => {
    const result = claimBreakdown({ ...base, certifiedProgressPct: '0.25' });
    expect(result.grossAmount.toString()).toBe('250000000');
  });

  // A correction downwards is not a negative invoice.
  it('refuses to bill a negative increment', () => {
    const result = claimBreakdown({
      ...base,
      certifiedProgressPct: '0.2',
      previouslyCertifiedPct: '0.3',
    });
    expect(result.grossAmount.toString()).toBe('0');
    expect(result.netAmount.toString()).toBe('0');
  });

  it('withholds retention and charges the taxes on gross', () => {
    const result = claimBreakdown({ ...base, certifiedProgressPct: '0.1' });

    expect(result.grossAmount.toString()).toBe('100000000');
    expect(result.retentionWithheld.toString()).toBe('5000000');
    expect(result.vatAmount.toString()).toBe('11000000');
    expect(result.whtAmount.toString()).toBe('2000000');
    // 100 − 5 + 11 − 2
    expect(result.netAmount.toString()).toBe('104000000');
  });

  it('recoups the advance out of the gross', () => {
    const result = claimBreakdown({
      ...base,
      certifiedProgressPct: '0.1',
      dpRecoupmentPercent: '0.2',
      dpOutstanding: '100000000',
    });
    expect(result.dpRecoupment.toString()).toBe('20000000');
    expect(result.netAmount.toString()).toBe('84000000');
  });

  // Recouping more than was advanced would turn the owner into a creditor.
  it('never recoups more than remains outstanding', () => {
    const result = claimBreakdown({
      ...base,
      certifiedProgressPct: '0.5',
      dpRecoupmentPercent: '0.5',
      dpOutstanding: '10000000',
    });
    expect(result.dpRecoupment.toString()).toBe('10000000');
  });

  it('handles a project with no retention or tax', () => {
    const result = claimBreakdown({
      contractValue: '500000000',
      certifiedProgressPct: '0.4',
      retentionPercent: '0',
      vatPercent: '0',
      whtPercent: '0',
    });
    expect(result.netAmount.toString()).toBe('200000000');
  });

  it('caps certified progress at 100%', () => {
    const result = claimBreakdown({ ...base, certifiedProgressPct: '1.5' });
    expect(result.grossAmount.toString()).toBe('1000000000');
  });
});

describe('costVariance', () => {
  // Spending 40% of the budget is fine at 40% done and alarming at 15%.
  it('measures spend against work done, not against the whole budget', () => {
    const healthy = costVariance('1200', '1000', '400', '0.4');
    expect(healthy.earned.toString()).toBe('400');
    expect(healthy.status).toBe('ON_BUDGET');

    const bleeding = costVariance('1200', '1000', '400', '0.15');
    expect(bleeding.status).toBe('OVER');
    expect(bleeding.costVariance.toString()).toBe('-250');
  });

  it('calls a frugal project under budget', () => {
    const result = costVariance('1200', '1000', '300', '0.5');
    expect(result.status).toBe('UNDER');
    expect(result.costVariance.toString()).toBe('200');
  });

  it('treats a difference inside the tolerance as noise', () => {
    const result = costVariance('1200', '1000', '402', '0.4');
    expect(result.status).toBe('ON_BUDGET');
  });

  it('honours a stricter tolerance', () => {
    const result = costVariance('1200', '1000', '402', '0.4', '0.001');
    expect(result.status).toBe('OVER');
  });

  it('reports CPI and the projected final cost', () => {
    const result = costVariance('1200', '1000', '500', '0.4');
    expect(result.cpi?.toString()).toBe('0.8');
    expect(result.estimateAtCompletion?.toString()).toBe('1250');
  });

  // Dividing by nothing spent would make day one look infinitely efficient.
  it('leaves CPI unknown before anything is spent', () => {
    const result = costVariance('1200', '1000', '0', '0');
    expect(result.cpi).toBeNull();
    expect(result.estimateAtCompletion).toBeNull();
  });
});

describe('projectedMargin', () => {
  it('is what was sold minus what it will cost', () => {
    const result = projectedMargin('1200', '1000');
    expect(result.amount.toString()).toBe('200');
    expect(result.percent?.toFixed(4)).toBe('0.1667');
  });

  it('goes negative when the projection exceeds the contract', () => {
    expect(projectedMargin('1000', '1250').amount.toString()).toBe('-250');
  });

  it('treats an unknown projection as nothing spent yet', () => {
    expect(projectedMargin('1000', null).amount.toString()).toBe('1000');
  });
});
