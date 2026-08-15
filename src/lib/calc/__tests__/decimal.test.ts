import { describe, expect, it } from 'vitest';

import {
  approxEquals,
  clamp,
  Decimal,
  isZero,
  maxOf,
  minOf,
  roundMoney,
  safeDivide,
  sum,
  sumBy,
  toCoefficientString,
  toDecimal,
  toDecimalOrNull,
  toMoneyString,
  toPercentString,
  toQuantityString,
} from '../decimal';

describe('toDecimal', () => {
  it('reads numeric column strings without losing precision', () => {
    expect(toDecimal('12345678901234.56').toFixed(2)).toBe('12345678901234.56');
  });

  it('treats absent values as zero', () => {
    expect(toDecimal(null).toString()).toBe('0');
    expect(toDecimal(undefined).toString()).toBe('0');
    expect(toDecimal('').toString()).toBe('0');
    expect(toDecimal('   ').toString()).toBe('0');
  });

  it('passes a Decimal through untouched', () => {
    const d = new Decimal('1.5');
    expect(toDecimal(d)).toBe(d);
  });

  it('rejects values that are not finite numbers', () => {
    expect(() => toDecimal(Number.NaN)).toThrow(/tidak valid/);
    expect(() => toDecimal(Number.POSITIVE_INFINITY)).toThrow(/tidak valid/);
    expect(() => toDecimal('bukan angka')).toThrow();
  });
});

describe('toDecimalOrNull', () => {
  it('keeps "absent" distinct from zero', () => {
    expect(toDecimalOrNull(null)).toBeNull();
    expect(toDecimalOrNull('')).toBeNull();
    expect(toDecimalOrNull('0')?.toString()).toBe('0');
  });
});

describe('money arithmetic', () => {
  // The classic float failure: 0.1 + 0.2 !== 0.3.
  it('adds fractional rupiah exactly', () => {
    expect(sum(['0.1', '0.2']).toString()).toBe('0.3');
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  it('sums a large ledger without drift', () => {
    const rows = Array.from({ length: 1000 }, () => '0.01');
    expect(sum(rows).toFixed(2)).toBe('10.00');
  });

  it('sums by projection', () => {
    const items = [{ amount: '1500.50' }, { amount: '2499.50' }, { amount: null }];
    expect(sumBy(items, (i) => i.amount).toFixed(2)).toBe('4000.00');
  });

  it('sums an empty list to zero rather than throwing', () => {
    expect(sum([]).toString()).toBe('0');
  });
});

describe('safeDivide', () => {
  it('divides normally', () => {
    expect(safeDivide('10', '4')?.toString()).toBe('2.5');
  });

  // Section 5.5: never NaN, never Infinity — the UI needs a distinguishable
  // "unknown" so it can render an em dash.
  it('returns null instead of Infinity when the divisor is zero', () => {
    expect(safeDivide('10', '0')).toBeNull();
    expect(safeDivide('10', null)).toBeNull();
    expect(safeDivide('0', '0')).toBeNull();
  });

  it('returns zero, not null, when only the numerator is zero', () => {
    expect(safeDivide('0', '5')?.toString()).toBe('0');
  });
});

describe('scale helpers', () => {
  it('serialises to each column scale', () => {
    expect(toMoneyString('1620000.005')).toBe('1620000.01');
    expect(toQuantityString('12.34567')).toBe('12.3457');
    expect(toCoefficientString('0.0000005')).toBe('0.000001');
    expect(toPercentString('0.155')).toBe('0.155000');
  });

  it('rounds money half-up, the convention used in the source workbook', () => {
    expect(roundMoney('2.005').toFixed(2)).toBe('2.01');
    expect(roundMoney('2.004').toFixed(2)).toBe('2.00');
  });
});

describe('invariant helpers', () => {
  it('clamps a cumulative percentage into 0..1', () => {
    expect(clamp('1.4', 0, 1).toString()).toBe('1');
    expect(clamp('-0.2', 0, 1).toString()).toBe('0');
    expect(clamp('0.35', 0, 1).toString()).toBe('0.35');
  });

  it('accepts sixth-decimal rounding when checking Σ weight = 1', () => {
    const weights = ['0.333333', '0.333333', '0.333334'];
    expect(approxEquals(sum(weights), 1, '1e-9')).toBe(true);
    expect(approxEquals('0.99', 1, '1e-9')).toBe(false);
  });

  it('detects zero across representations', () => {
    expect(isZero('0.000')).toBe(true);
    expect(isZero(null)).toBe(true);
    expect(isZero('0.0001')).toBe(false);
  });

  it('finds extremes and returns null for an empty set', () => {
    expect(maxOf(['15500', '16200', '15000'])?.toString()).toBe('16200');
    expect(minOf(['15500', '16200', '15000'])?.toString()).toBe('15000');
    expect(maxOf([])).toBeNull();
    expect(minOf([])).toBeNull();
  });
});

describe('worked example from the charter', () => {
  // Section 8: volume 100 m³ × 8 zak semen × Rp48.000 = Rp38.400.000
  it('computes cement cost for 100 m3', () => {
    const volume = toDecimal('100');
    const coefficient = toDecimal('8');
    const price = toDecimal('48000');
    expect(volume.times(coefficient).times(price).toFixed(2)).toBe('38400000.00');
  });

  // Section 8: a 5% waste factor adds exactly 5%.
  it('applies a waste factor exactly', () => {
    const base = toDecimal('100').times('8');
    const withWaste = base.times(toDecimal('1').plus('0.05'));
    expect(withWaste.toString()).toBe('840');
    expect(withWaste.minus(base).toString()).toBe('40');
  });

  // Section 8: moving average of 100 @15.500 then 100 @16.200 is 15.850.
  it('computes a weighted moving average', () => {
    const prevQty = toDecimal('100');
    const prevAvg = toDecimal('15500');
    const inQty = toDecimal('100');
    const inPrice = toDecimal('16200');
    const newAvg = prevQty
      .times(prevAvg)
      .plus(inQty.times(inPrice))
      .dividedBy(prevQty.plus(inQty));
    expect(newAvg.toFixed(2)).toBe('15850.00');
  });
});
