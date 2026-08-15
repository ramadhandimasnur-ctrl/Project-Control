import { describe, expect, it } from 'vitest';

import { approxEquals, sum } from '../decimal';
import { basisValue, computeWeights, reconcileContractValue, type WeightInput } from '../weight';

/** The four demo work items, with their hand-checked totals. */
const ITEMS: WeightInput[] = [
  {
    id: 'A.01',
    contractValue: '125000000',
    totalRab: '112669000',
    totalRap: '107865000',
    includeInProgressWeight: true,
  },
  {
    id: 'A.02',
    contractValue: '264000000',
    totalRab: '224280000',
    totalRap: '217140000',
    includeInProgressWeight: true,
  },
  {
    id: 'B.01',
    contractValue: '83250000',
    totalRab: '58387500',
    totalRap: '56092500',
    includeInProgressWeight: true,
  },
  {
    id: 'Z.01',
    contractValue: '0',
    totalRab: '90000000',
    totalRap: '84000000',
    includeInProgressWeight: false,
  },
];

describe('basisValue', () => {
  it('selects the configured basis', () => {
    const item = ITEMS[0]!;
    expect(basisValue(item, 'CONTRACT').toString()).toBe('125000000');
    expect(basisValue(item, 'RAB').toString()).toBe('112669000');
    expect(basisValue(item, 'RAP').toString()).toBe('107865000');
  });
});

describe('computeWeights', () => {
  // The invariant the whole progress model rests on.
  it.each(['CONTRACT', 'RAB', 'RAP'] as const)('sums to exactly 1 on basis %s', (basis) => {
    const weights = computeWeights(ITEMS, basis);
    expect(approxEquals(sum(weights.map((w) => w.weight)), 1, '1e-9')).toBe(true);
  });

  // Charter section 8: an excluded item adds no weight.
  it('gives zero weight to items excluded from progress', () => {
    const weights = computeWeights(ITEMS, 'CONTRACT');
    const overhead = weights.find((w) => w.id === 'Z.01');
    expect(overhead?.weight.toString()).toBe('0');
  });

  it('weights by share of the contract value', () => {
    const weights = computeWeights(ITEMS, 'CONTRACT');
    // 264.000.000 / 472.250.000
    expect(weights.find((w) => w.id === 'A.02')?.weight.toFixed(6)).toBe('0.559026');
    expect(weights.find((w) => w.id === 'A.01')?.weight.toFixed(6)).toBe('0.264690');
    expect(weights.find((w) => w.id === 'B.01')?.weight.toFixed(6)).toBe('0.176284');
  });

  it('changes the answer when the basis changes', () => {
    const byContract = computeWeights(ITEMS, 'CONTRACT').find((w) => w.id === 'A.01')?.weight;
    const byRap = computeWeights(ITEMS, 'RAP').find((w) => w.id === 'A.01')?.weight;
    expect(byContract?.toFixed(6)).not.toBe(byRap?.toFixed(6));
  });

  // A project with no estimate yet must not divide by zero.
  it('returns zero weights instead of NaN when nothing carries weight', () => {
    const empty: WeightInput[] = [
      { id: 'x', contractValue: '0', totalRab: '0', totalRap: '0', includeInProgressWeight: true },
    ];
    const weights = computeWeights(empty, 'CONTRACT');
    expect(weights[0]?.weight.toString()).toBe('0');
  });

  it('handles an empty project', () => {
    expect(computeWeights([], 'CONTRACT')).toEqual([]);
  });
});

describe('reconcileContractValue', () => {
  it('accepts the demo project, which balances exactly', () => {
    const result = reconcileContractValue(ITEMS, '472250000');
    expect(result.sumOfWorkItemContractValues.toFixed(2)).toBe('472250000.00');
    expect(result.difference.toString()).toBe('0');
    expect(result.needsAttention).toBe(false);
  });

  it('flags a gap larger than 0,1% and reports the actual figures', () => {
    const result = reconcileContractValue(ITEMS, '480000000');
    expect(result.difference.toFixed(2)).toBe('-7750000.00');
    expect(result.differencePercent?.times(100).toFixed(4)).toBe('-1.6146');
    expect(result.needsAttention).toBe(true);
  });

  it('tolerates rounding below the threshold', () => {
    // 100 rupiah out of 472 million is far inside 0,1%.
    const result = reconcileContractValue(ITEMS, '472250100');
    expect(result.needsAttention).toBe(false);
  });

  it('flags any non-zero gap when the declared value is zero', () => {
    expect(reconcileContractValue(ITEMS, '0').needsAttention).toBe(true);
    expect(reconcileContractValue([], '0').needsAttention).toBe(false);
  });
});
