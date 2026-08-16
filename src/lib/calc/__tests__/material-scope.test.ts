import { describe, expect, it } from 'vitest';

import { materialForScope, type ScopeLine } from '../material';

const line = (over: Partial<ScopeLine> = {}): ScopeLine => ({
  resourceId: 'semen',
  resourceCode: 'M.01',
  resourceName: 'Semen',
  unitCode: 'zak',
  volume: '100',
  coefRap: '0.5',
  wasteFactor: '0',
  fraction: '1',
  priceRap: '65000',
  stock: '0',
  ...over,
});

describe('materialForScope', () => {
  it('multiplies volume, coefficient and the fraction in scope', () => {
    const result = materialForScope([line({ fraction: '0.4' })]);
    expect(result.rows[0]?.required.toString()).toBe('20');
    expect(result.rows[0]?.toBuy.toString()).toBe('20');
    expect(result.totalCost.toString()).toBe('1300000');
  });

  it('includes planned waste in the quantity', () => {
    const result = materialForScope([line({ wasteFactor: '0.05' })]);
    expect(result.rows[0]?.required.toString()).toBe('52.5');
  });

  /*
   * A purchasing list answers one question per material, not one per work
   * item — cement used by three work items is one order.
   */
  it('aggregates one row per resource across work items', () => {
    const result = materialForScope([
      line({ volume: '100', fraction: '1' }),
      line({ volume: '40', fraction: '1' }),
      line({ resourceId: 'pasir', resourceCode: 'M.02', resourceName: 'Pasir', volume: '10' }),
    ]);

    expect(result.rows).toHaveLength(2);
    const semen = result.rows.find((row) => row.resourceId === 'semen');
    expect(semen?.required.toString()).toBe('70');
  });

  /*
   * Stock is deducted once per resource. Deducting it against every line would
   * spend the same sack of cement several times and understate the order.
   */
  it('subtracts stock once, not once per line', () => {
    const result = materialForScope([
      line({ volume: '100', stock: '30' }),
      line({ volume: '100', stock: '30' }),
    ]);

    const semen = result.rows[0]!;
    expect(semen.required.toString()).toBe('100');
    expect(semen.stock.toString()).toBe('30');
    expect(semen.toBuy.toString()).toBe('70');
  });

  it('never asks to buy a negative quantity', () => {
    const result = materialForScope([line({ volume: '10', stock: '500' })]);
    expect(result.rows[0]?.toBuy.toString()).toBe('0');
    expect(result.totalCost.toString()).toBe('0');
  });

  /*
   * Pricing an unknown at zero produces a total that looks complete and is
   * quietly short — the kind of number someone commits money against.
   */
  it('counts quantity but not cost when the price is unknown', () => {
    const result = materialForScope([
      line({ priceRap: null }),
      line({ resourceId: 'pasir', resourceCode: 'M.02', resourceName: 'Pasir', volume: '20' }),
    ]);

    expect(result.unpriced).toEqual([{ resourceCode: 'M.01', resourceName: 'Semen' }]);
    expect(result.rows.find((row) => row.resourceId === 'semen')?.cost).toBeNull();
    expect(result.totalCost.toString()).toBe('650000');
  });

  it('drops work that is entirely outside the scope', () => {
    const result = materialForScope([line({ fraction: '0' })]);
    expect(result.rows).toEqual([]);
    expect(result.totalCost.toString()).toBe('0');
  });

  it('puts the biggest spend at the top', () => {
    const result = materialForScope([
      line({ resourceId: 'kecil', resourceCode: 'M.09', volume: '1' }),
      line({ resourceId: 'besar', resourceCode: 'M.01', volume: '100' }),
    ]);

    expect(result.rows.map((row) => row.resourceId)).toEqual(['besar', 'kecil']);
  });
});
