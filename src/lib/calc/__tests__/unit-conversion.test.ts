import { describe, expect, it } from 'vitest';

import { convertQuantity, isConvertible, type ConvertibleUnit } from '../unit-conversion';

const kg: ConvertibleUnit = { code: 'kg', dimension: 'MASS', factorToBase: '1' };
const ton: ConvertibleUnit = { code: 'ton', dimension: 'MASS', factorToBase: '1000' };
const m3: ConvertibleUnit = { code: 'm3', dimension: 'VOLUME', factorToBase: '1' };
const zak: ConvertibleUnit = { code: 'zak', dimension: 'COUNT', factorToBase: '1' };

describe('convertQuantity', () => {
  it('returns the quantity untouched for the same unit', () => {
    const result = convertQuantity('50', kg, kg);
    expect(result.ok && result.value.toString()).toBe('50');
    expect(result.ok && result.converted).toBe(false);
  });

  it('converts within a dimension using the base factors', () => {
    const up = convertQuantity('2', ton, kg);
    expect(up.ok && up.value.toString()).toBe('2000');
    expect(up.ok && up.converted).toBe(true);

    const down = convertQuantity('500', kg, ton);
    expect(down.ok && down.value.toString()).toBe('0.5');
  });

  it('round-trips exactly', () => {
    const there = convertQuantity('7.5', ton, kg);
    const back = there.ok ? convertQuantity(there.value, kg, ton) : null;
    expect(back?.ok && back.value.toString()).toBe('7.5');
  });

  // Rule 8: turning 50 sacks into 50 m3 is an error that survives all the way
  // to a purchase order, so it is refused rather than approximated.
  it('refuses to cross dimensions', () => {
    const result = convertQuantity('50', zak, m3);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toMatch(/mengukur hal yang berbeda/);
  });

  it('refuses a zero or negative factor', () => {
    const broken: ConvertibleUnit = { code: 'x', dimension: 'MASS', factorToBase: '0' };
    expect(convertQuantity('1', broken, kg).ok).toBe(false);
    expect(convertQuantity('1', kg, broken).ok).toBe(false);
  });

  it('names both units in the refusal so the message is actionable', () => {
    const result = convertQuantity('1', zak, m3);
    expect(!result.ok && result.message).toContain('zak');
    expect(!result.ok && result.message).toContain('m3');
  });

  it('handles zero and fractional quantities', () => {
    const zero = convertQuantity('0', ton, kg);
    expect(zero.ok && zero.value.toString()).toBe('0');

    const third = convertQuantity('1', kg, ton);
    expect(third.ok && third.value.toFixed(6)).toBe('0.001000');
  });
});

describe('isConvertible', () => {
  it('is true within a dimension and false across', () => {
    expect(isConvertible(kg, ton)).toBe(true);
    expect(isConvertible(kg, m3)).toBe(false);
  });
});
