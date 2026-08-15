import { describe, expect, it } from 'vitest';

import {
  contractValue,
  estimateWorkItem,
  margin,
  marginPercent,
  qtyRab,
  qtyRap,
  totalRab,
  totalRap,
  unitCostRab,
  unitCostRap,
  type EstimateLine,
} from '../estimate';

/** The K-225 concrete analysis from the demo seed, per m3. */
const CONCRETE_LINES: EstimateLine[] = [
  { coefRab: '8', coefRap: '8', priceRab: '50000', priceRap: '48000' },
  { coefRab: '0.5', coefRap: '0.5', priceRab: '300000', priceRap: '285000' },
  { coefRab: '0.8', coefRap: '0.8', priceRab: '350000', priceRap: '335000' },
  { coefRab: '1.65', coefRap: '1.65', priceRab: '120000', priceRap: '115000' },
  { coefRab: '0.275', coefRap: '0.275', priceRab: '150000', priceRap: '145000' },
  { coefRab: '0.083', coefRap: '0.083', priceRab: '180000', priceRap: '175000' },
  { coefRab: '0.5', coefRap: '0.5', priceRab: '85000', priceRap: '80000' },
];

describe('quantities', () => {
  // Charter section 8: volume 100 m3, 8 zak cement, RAP Rp48.000 → Rp38.400.000
  it('computes cement quantity and cost for 100 m3', () => {
    const qty = qtyRap('100', '8');
    expect(qty.toString()).toBe('800');
    expect(qty.times('48000').toFixed(2)).toBe('38400000.00');
  });

  // Charter section 8: a 5% waste factor adds exactly 5%.
  it('applies waste as an exact multiplier', () => {
    const withoutWaste = qtyRap('12000', '1');
    const withWaste = qtyRap('12000', '1', '0.05');
    expect(withoutWaste.toString()).toBe('12000');
    expect(withWaste.toString()).toBe('12600');
    expect(withWaste.minus(withoutWaste).toString()).toBe('600');
  });

  it('treats a missing waste factor as zero', () => {
    expect(qtyRab('100', '2').toString()).toBe(qtyRab('100', '2', '0').toString());
  });

  it('lets RAB and RAP coefficients differ', () => {
    expect(qtyRab('100', '8').toString()).toBe('800');
    expect(qtyRap('100', '7.5').toString()).toBe('750');
  });
});

describe('unit cost', () => {
  it('sums the concrete analysis to the hand-checked unit rates', () => {
    // 400.000 + 150.000 + 280.000 + 198.000 + 41.250 + 14.940 + 42.500
    expect(unitCostRab(CONCRETE_LINES).toFixed(2)).toBe('1126690.00');
    // 384.000 + 142.500 + 268.000 + 189.750 + 39.875 + 14.525 + 40.000
    expect(unitCostRap(CONCRETE_LINES).toFixed(2)).toBe('1078650.00');
  });

  it('is zero for an empty analysis rather than throwing', () => {
    expect(unitCostRab([]).toString()).toBe('0');
    expect(unitCostRap([]).toString()).toBe('0');
  });

  it('includes waste in the unit rate', () => {
    const lines: EstimateLine[] = [
      { coefRab: '1', coefRap: '1', wasteFactor: '0.05', priceRab: '16000', priceRap: '15500' },
    ];
    expect(unitCostRab(lines).toFixed(2)).toBe('16800.00');
    expect(unitCostRap(lines).toFixed(2)).toBe('16275.00');
  });
});

describe('totals', () => {
  it('scales the unit rate by volume', () => {
    expect(totalRab('100', CONCRETE_LINES).toFixed(2)).toBe('112669000.00');
    expect(totalRap('100', CONCRETE_LINES).toFixed(2)).toBe('107865000.00');
  });

  // Charter section 8: volume 0 gives a total of 0 and must not error.
  it('returns zero for zero volume', () => {
    expect(totalRab('0', CONCRETE_LINES).toString()).toBe('0');
    expect(totalRap('0', CONCRETE_LINES).toString()).toBe('0');
  });
});

describe('contractValue', () => {
  it('uses the contract unit price when one exists', () => {
    expect(contractValue('100', '1250000', '112669000', '0.1').toFixed(2)).toBe('125000000.00');
  });

  it('falls back to RAB plus markup when there is no contract price', () => {
    expect(contractValue('6', null, '90000000', '0.1').toFixed(2)).toBe('99000000.00');
    expect(contractValue('6', undefined, '90000000', '0').toFixed(2)).toBe('90000000.00');
  });

  // A contract price of zero is a real decision — an overhead line that is not
  // separately billable — and must not be mistaken for "absent".
  it('honours an explicit zero contract price', () => {
    expect(contractValue('6', '0', '90000000', '0.1').toString()).toBe('0');
  });
});

describe('margin', () => {
  it('computes margin and its percentage', () => {
    expect(margin('125000000', '107865000').toFixed(2)).toBe('17135000.00');
    expect(marginPercent('125000000', '107865000')?.times(100).toFixed(4)).toBe('13.7080');
  });

  it('reports a negative margin rather than clamping it', () => {
    expect(margin('0', '84000000').toFixed(2)).toBe('-84000000.00');
  });

  // Section 5.5: no NaN, no Infinity — "unknown" is null.
  it('returns null when there is no contract value', () => {
    expect(marginPercent('0', '84000000')).toBeNull();
  });
});

describe('estimateWorkItem', () => {
  it('produces every figure the AHSP footer shows', () => {
    const result = estimateWorkItem({
      volume: '100',
      lines: CONCRETE_LINES,
      contractUnitPrice: '1250000',
    });

    expect(result.unitCostRab.toFixed(2)).toBe('1126690.00');
    expect(result.unitCostRap.toFixed(2)).toBe('1078650.00');
    expect(result.totalRab.toFixed(2)).toBe('112669000.00');
    expect(result.totalRap.toFixed(2)).toBe('107865000.00');
    expect(result.contractValue.toFixed(2)).toBe('125000000.00');
    expect(result.margin.toFixed(2)).toBe('17135000.00');
    expect(result.estimateSpread.toFixed(2)).toBe('4804000.00');
  });

  it('handles a work item with no analysis lines', () => {
    const result = estimateWorkItem({ volume: '10', lines: [], contractUnitPrice: null });
    expect(result.totalRab.toString()).toBe('0');
    expect(result.contractValue.toString()).toBe('0');
    expect(result.marginPercent).toBeNull();
    expect(result.estimateSpreadPercent).toBeNull();
  });
});
