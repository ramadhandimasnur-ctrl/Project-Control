import { describe, expect, it } from 'vitest';

import { compareScope, summariseRevision } from '../contract-revision';

const line = (over: Partial<Parameters<typeof summariseRevision>[0][number]>) => ({
  workItemId: 'w1',
  code: 'A.01',
  name: 'Beton K-225',
  unitCode: 'm3',
  volumeBefore: '100',
  volumeAfter: '100',
  unitValue: '1250000',
  includeInProgressWeight: true,
  ...over,
});

describe('summariseRevision', () => {
  it('values a volume increase at the item rate', () => {
    const result = summariseRevision([line({ volumeAfter: '120' })], '125000000');

    expect(result.lines[0]?.kind).toBe('CHANGE');
    expect(result.lines[0]?.volumeDelta.toString()).toBe('20');
    expect(result.lines[0]?.valueDelta.toFixed(2)).toBe('25000000.00');
    expect(result.addedValue.toFixed(2)).toBe('25000000.00');
    expect(result.removedValue.toString()).toBe('0');
    expect(result.contractValueAfter.toFixed(2)).toBe('150000000.00');
  });

  /*
   * Adding and removing are the same operation on a volume. Naming them
   * separately is for the reader of the printed sheet, not for the arithmetic.
   */
  it('reads a line starting from zero as an addition', () => {
    const result = summariseRevision(
      [line({ workItemId: 'w2', code: 'A.09', volumeBefore: '0', volumeAfter: '30' })],
      '125000000',
    );

    expect(result.lines[0]?.kind).toBe('ADD');
    expect(result.addedValue.toFixed(2)).toBe('37500000.00');
  });

  it('reads a line ending at zero as a removal', () => {
    const result = summariseRevision([line({ volumeAfter: '0' })], '125000000');

    expect(result.lines[0]?.kind).toBe('REMOVE');
    expect(result.removedValue.toFixed(2)).toBe('125000000.00');
    expect(result.netValue.toFixed(2)).toBe('-125000000.00');
    expect(result.contractValueAfter.toString()).toBe('0');
  });

  /*
   * Added and removed are reported side by side rather than netted into one
   * figure. "Tambah 40 juta, kurang 15 juta" is what an addendum has to say;
   * a single net 25 million hides half of what was agreed.
   */
  it('keeps additions and removals separate as well as netted', () => {
    const result = summariseRevision(
      [
        line({ volumeAfter: '132' }),
        line({ workItemId: 'w2', code: 'A.02', unitValue: '500000', volumeAfter: '70' }),
      ],
      '125000000',
    );

    expect(result.addedValue.toFixed(2)).toBe('40000000.00');
    expect(result.removedValue.toFixed(2)).toBe('15000000.00');
    expect(result.netValue.toFixed(2)).toBe('25000000.00');
    expect(result.netPercent?.toFixed(4)).toBe('0.2000');
  });

  it('reports no percentage when there was no contract to compare against', () => {
    const result = summariseRevision([line({ volumeAfter: '120' })], '0');
    expect(result.netPercent).toBeNull();
  });

  it('leaves an untouched volume out of both totals', () => {
    const result = summariseRevision([line({})], '125000000');
    expect(result.netValue.toString()).toBe('0');
    expect(result.contractValueAfter.toFixed(2)).toBe('125000000.00');
  });
});

describe('compareScope', () => {
  const base = {
    workItemId: 'w1',
    code: 'A.01',
    name: 'Beton',
    unitCode: 'm3',
    baselineVolume: '100',
    baselineValue: '125000000',
    baselineWeight: '1',
    currentVolume: '120',
    currentValue: '150000000',
    currentWeight: '1',
  };

  it('reports the movement in volume, value and weight', () => {
    const { rows, totals } = compareScope([base]);

    expect(rows[0]?.volumeDelta.toString()).toBe('20');
    expect(rows[0]?.valueDelta.toFixed(2)).toBe('25000000.00');
    expect(totals.valuePercent?.toFixed(4)).toBe('0.2000');
  });

  /*
   * An item added by a revision has no baseline, and one removed entirely has
   * no current figure. Both still print: dropping either would leave a column
   * that no longer adds up to its own total.
   */
  it('keeps items present on only one side', () => {
    const { rows, totals } = compareScope([
      { ...base, currentVolume: '0', currentValue: '0', currentWeight: '0' },
      {
        ...base,
        workItemId: 'w2',
        code: 'A.09',
        baselineVolume: '0',
        baselineValue: '0',
        baselineWeight: '0',
        currentVolume: '30',
        currentValue: '37500000',
        currentWeight: '1',
      },
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]?.valueDelta.toFixed(2)).toBe('-125000000.00');
    expect(rows[1]?.valueDelta.toFixed(2)).toBe('37500000.00');
    expect(totals.currentValue.toFixed(2)).toBe('37500000.00');
    expect(totals.valueDelta.toFixed(2)).toBe('-87500000.00');
  });
});
