import Decimal from 'decimal.js';

/**
 * Numeric foundation for every calculation in the system.
 *
 * Charter rule 2: money never touches a float. Postgres hands us `numeric`
 * columns as strings; they enter decimal.js here and only become a rounded
 * number at the presentation layer.
 *
 * Charter rule 12 / section 5.5: a division by zero is not an error and not
 * `Infinity` — it is "unknown", represented as `null`, and rendered as "—".
 */

// 34 significant digits comfortably covers numeric(18,6) intermediate products
// (e.g. volume × coefficient × price) without accumulating representation error.
Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -30, toExpPos: 30 });

export { Decimal };

/** Anything that can stand in for a decimal at a module boundary. */
export type Numeric = Decimal | string | number;

export const ZERO = new Decimal(0);
export const ONE = new Decimal(1);

/**
 * Coerces a value to Decimal. `null`/`undefined`/empty string mean "absent"
 * and become zero, which is what an empty coefficient or price cell means.
 */
export function toDecimal(value: Numeric | null | undefined): Decimal {
  if (value === null || value === undefined) return ZERO;
  if (value instanceof Decimal) return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Nilai numerik tidak valid: ${String(value)}`);
    }
    return new Decimal(value);
  }
  const trimmed = value.trim();
  if (trimmed === '') return ZERO;
  const parsed = new Decimal(trimmed);
  if (!parsed.isFinite()) {
    throw new TypeError(`Nilai numerik tidak valid: ${value}`);
  }
  return parsed;
}

/** Coerces to Decimal but preserves "absent" as null (no silent zero). */
export function toDecimalOrNull(value: Numeric | null | undefined): Decimal | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  return toDecimal(value);
}

export function sum(values: readonly (Numeric | null | undefined)[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(toDecimal(v)), ZERO);
}

export function sumBy<T>(items: readonly T[], pick: (item: T) => Numeric | null | undefined): Decimal {
  return items.reduce<Decimal>((acc, item) => acc.plus(toDecimal(pick(item))), ZERO);
}

/**
 * Division that refuses to invent a number. Returns `null` when the divisor is
 * zero, so callers must decide what "unknown" looks like instead of silently
 * propagating Infinity or NaN.
 */
export function safeDivide(
  numerator: Numeric | null | undefined,
  denominator: Numeric | null | undefined,
): Decimal | null {
  const d = toDecimal(denominator);
  if (d.isZero()) return null;
  return toDecimal(numerator).dividedBy(d);
}

/** Rounds to the money scale, numeric(18,2). Display and persistence only. */
export function roundMoney(value: Numeric | null | undefined): Decimal {
  return toDecimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** Rounds to the quantity scale, numeric(18,4). */
export function roundQuantity(value: Numeric | null | undefined): Decimal {
  return toDecimal(value).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

/** Rounds to the coefficient scale, numeric(18,6). */
export function roundCoefficient(value: Numeric | null | undefined): Decimal {
  return toDecimal(value).toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
}

/** Rounds to the percentage scale, numeric(9,6), still as a 0..1 fraction. */
export function roundPercent(value: Numeric | null | undefined): Decimal {
  return toDecimal(value).toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
}

/** Serialises for a `numeric` column at the given scale. */
export function toMoneyString(value: Numeric | null | undefined): string {
  return roundMoney(value).toFixed(2);
}

export function toQuantityString(value: Numeric | null | undefined): string {
  return roundQuantity(value).toFixed(4);
}

export function toCoefficientString(value: Numeric | null | undefined): string {
  return roundCoefficient(value).toFixed(6);
}

export function toPercentString(value: Numeric | null | undefined): string {
  return roundPercent(value).toFixed(6);
}

/** Clamps into [min, max]; used for cumulative percentages bounded at 0..1. */
export function clamp(value: Numeric, min: Numeric, max: Numeric): Decimal {
  const v = toDecimal(value);
  const lo = toDecimal(min);
  const hi = toDecimal(max);
  if (v.lessThan(lo)) return lo;
  if (v.greaterThan(hi)) return hi;
  return v;
}

/**
 * Tolerant equality for invariants such as `Σ weight = 1`, where exact
 * comparison would fail on legitimate rounding at the sixth decimal.
 */
export function approxEquals(a: Numeric, b: Numeric, tolerance: Numeric = '1e-9'): boolean {
  return toDecimal(a).minus(toDecimal(b)).abs().lessThanOrEqualTo(toDecimal(tolerance));
}

export function isZero(value: Numeric | null | undefined): boolean {
  return toDecimal(value).isZero();
}

export function maxOf(values: readonly Numeric[]): Decimal | null {
  if (values.length === 0) return null;
  return values.reduce<Decimal>((acc, v) => {
    const d = toDecimal(v);
    return d.greaterThan(acc) ? d : acc;
  }, toDecimal(values[0]));
}

export function minOf(values: readonly Numeric[]): Decimal | null {
  if (values.length === 0) return null;
  return values.reduce<Decimal>((acc, v) => {
    const d = toDecimal(v);
    return d.lessThan(acc) ? d : acc;
  }, toDecimal(values[0]));
}
