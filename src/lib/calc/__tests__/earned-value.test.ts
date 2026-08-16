import { describe, expect, it } from 'vitest';

import { earnedValue, performanceVerdict } from '../earned-value';

describe('earnedValue', () => {
  const base = {
    budgetAtCompletion: '1000',
    plannedCumulativePct: '0.5',
    actualCumulativePct: '0.4',
    actualCost: '500',
  };

  it('derives PV and EV from the budget at completion', () => {
    const result = earnedValue(base);
    expect(result.pv.toString()).toBe('500');
    expect(result.ev.toString()).toBe('400');
    expect(result.ac.toString()).toBe('500');
  });

  /*
   * The whole point of EVA: being late and being expensive are different
   * failures. Here the project is both, and each index says which.
   */
  it('separates the cost problem from the schedule problem', () => {
    const result = earnedValue(base);

    expect(result.cv.toString()).toBe('-100');
    expect(result.sv.toString()).toBe('-100');
    expect(result.cpi?.toString()).toBe('0.8');
    expect(result.spi?.toString()).toBe('0.8');
  });

  it('projects the final cost from the cost trend', () => {
    const result = earnedValue(base);
    // 1000 / 0,8 → menghabiskan 1.250 bila lajunya tidak berubah.
    expect(result.eac?.toString()).toBe('1250');
    expect(result.etc?.toString()).toBe('750');
    expect(result.vac?.toString()).toBe('-250');
  });

  /*
   * A project that has spent nothing is not infinitely efficient, and one
   * whose plan expects nothing yet is not infinitely ahead. Both would report
   * a triumph on day one if these divided anyway.
   */
  it('refuses to score a project that has spent nothing', () => {
    const result = earnedValue({ ...base, actualCost: '0' });
    expect(result.cpi).toBeNull();
    expect(result.eac).toBeNull();
    expect(result.etc).toBeNull();
    expect(result.vac).toBeNull();
  });

  it('refuses to score a schedule that expects nothing yet', () => {
    const result = earnedValue({ ...base, plannedCumulativePct: '0' });
    expect(result.spi).toBeNull();
    expect(result.pv.toString()).toBe('0');
  });

  it('reports a healthy project above one on both indices', () => {
    const result = earnedValue({
      budgetAtCompletion: '1000',
      plannedCumulativePct: '0.4',
      actualCumulativePct: '0.5',
      actualCost: '400',
    });

    expect(result.cpi?.toString()).toBe('1.25');
    expect(result.spi?.toString()).toBe('1.25');
    expect(result.vac?.toString()).toBe('200');
  });

  it('caps the percentages it is given', () => {
    const result = earnedValue({ ...base, actualCumulativePct: '1.4' });
    expect(result.ev.toString()).toBe('1000');
  });
});

describe('performanceVerdict', () => {
  it('reads an index as a verdict', () => {
    expect(performanceVerdict(earnedValue({
      budgetAtCompletion: '100',
      plannedCumulativePct: '0.5',
      actualCumulativePct: '0.5',
      actualCost: '50',
    }).cpi)).toBe('GOOD');
  });

  // Unmeasured must not read as healthy — that is how an early warning is lost.
  it('does not flatter a project it cannot measure', () => {
    expect(performanceVerdict(null)).toBe('UNKNOWN');
  });
});
