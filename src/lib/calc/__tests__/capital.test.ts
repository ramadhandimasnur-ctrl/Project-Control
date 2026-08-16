import { describe, expect, it } from 'vitest';

import { simulateCapitalNeed, type SimulationCandidate } from '../capital';

/**
 * Three items covering the whole project: 20%, 30% and 50% of the weight,
 * costing 200, 300 and 500 under RAP and slightly more under RAB.
 */
const CANDIDATES: SimulationCandidate[] = [
  {
    workItemId: 'a',
    code: 'A.01',
    name: 'Galian',
    weight: '0.2',
    totalRab: '220',
    totalRap: '200',
    completed: '0',
    order: 1,
  },
  {
    workItemId: 'b',
    code: 'A.02',
    name: 'Pondasi',
    weight: '0.3',
    totalRab: '330',
    totalRap: '300',
    completed: '0',
    order: 2,
  },
  {
    workItemId: 'c',
    code: 'A.03',
    name: 'Struktur',
    weight: '0.5',
    totalRab: '550',
    totalRap: '500',
    completed: '0',
    order: 3,
  },
];

describe('simulateCapitalNeed', () => {
  it('takes whole items while they fit inside the target', () => {
    const result = simulateCapitalNeed(CANDIDATES, '0.5');

    expect(result.rows.map((row) => row.code)).toEqual(['A.01', 'A.02']);
    expect(result.rows.every((row) => !row.isPartial)).toBe(true);
    expect(result.totalRap.toString()).toBe('500');
    expect(result.totalRab.toString()).toBe('550');
  });

  /*
   * The target rarely lands on an item boundary, and rounding up to the next
   * whole item would overstate the cash needed — which is the number someone
   * is about to borrow against.
   */
  it('takes only the fraction of the last item that is needed', () => {
    const result = simulateCapitalNeed(CANDIDATES, '0.35');

    expect(result.rows.map((row) => row.code)).toEqual(['A.01', 'A.02']);
    const last = result.rows[1]!;
    expect(last.isPartial).toBe(true);
    expect(last.requiredFraction.toString()).toBe('0.5');
    expect(last.costRap.toString()).toBe('150');
    expect(result.totalRap.toString()).toBe('350');
  });

  it('follows plan order, not the cheapest way to the number', () => {
    const shuffled = [
      { ...CANDIDATES[2]!, order: 1 },
      { ...CANDIDATES[0]!, order: 2 },
      { ...CANDIDATES[1]!, order: 3 },
    ];
    const result = simulateCapitalNeed(shuffled, '0.5');

    expect(result.rows.map((row) => row.code)).toEqual(['A.03']);
    expect(result.totalRap.toString()).toBe('500');
  });

  it('counts what is already approved and charges only the remainder', () => {
    const partlyDone = CANDIDATES.map((candidate) =>
      candidate.code === 'A.01' ? { ...candidate, completed: '0.5' } : candidate,
    );
    const result = simulateCapitalNeed(partlyDone, '0.5');

    expect(result.currentWeight.toString()).toBe('0.1');
    expect(result.gap.toString()).toBe('0.4');

    const first = result.rows[0]!;
    expect(first.requiredFraction.toString()).toBe('0.5');
    expect(first.costRap.toString()).toBe('100');
    expect(result.totalRap.toString()).toBe('400');
  });

  it('asks for nothing when the target is already met', () => {
    const done = CANDIDATES.map((candidate) => ({ ...candidate, completed: '1' }));
    const result = simulateCapitalNeed(done, '0.5');

    expect(result.rows).toEqual([]);
    expect(result.gap.toString()).toBe('0');
    expect(result.totalRap.toString()).toBe('0');
    expect(result.achievable).toBe(true);
  });

  /*
   * Only happens when the work items do not carry the project's full weight
   * between them, which is a data problem the page should not hide.
   */
  it('says so when finishing everything still falls short', () => {
    const thin = [{ ...CANDIDATES[0]!, weight: '0.2' }];
    const result = simulateCapitalNeed(thin, '0.5');

    expect(result.achievable).toBe(false);
    expect(result.reachableWeight.toString()).toBe('0.2');
  });

  it('ignores items that carry no progress weight', () => {
    const withUnweighted = [
      ...CANDIDATES,
      {
        workItemId: 'd',
        code: 'A.04',
        name: 'Pekerjaan persiapan tanpa bobot',
        weight: '0',
        totalRab: '900',
        totalRap: '800',
        completed: '0',
        order: 0,
      },
    ];
    const result = simulateCapitalNeed(withUnweighted, '0.2');

    expect(result.rows.map((row) => row.code)).toEqual(['A.01']);
    expect(result.totalRap.toString()).toBe('200');
  });

  it('never asks for more than 100%', () => {
    const result = simulateCapitalNeed(CANDIDATES, '5');
    expect(result.targetWeight.toString()).toBe('1');
    expect(result.totalRap.toString()).toBe('1000');
  });
});
