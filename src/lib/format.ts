import { format as formatDate, parseISO } from 'date-fns';
import { id as localeId } from 'date-fns/locale';

import { toDecimal, type Numeric } from '@/lib/calc/decimal';

/**
 * Presentation layer only. This is the *sole* place where a Decimal becomes a
 * rounded, human-readable string — calculations upstream stay exact.
 *
 * Every "unknown" value (a division by zero upstream) renders as an em dash,
 * never NaN or Infinity.
 */

export const EMPTY_VALUE = '—';

const decimalFormatters = new Map<string, Intl.NumberFormat>();

function numberFormatter(min: number, max: number): Intl.NumberFormat {
  const key = `${min}:${max}`;
  let f = decimalFormatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat('id-ID', {
      minimumFractionDigits: min,
      maximumFractionDigits: max,
    });
    decimalFormatters.set(key, f);
  }
  return f;
}

/** "Rp 1.620.000" — whole rupiah, which is how construction reporting reads. */
export function formatCurrency(value: Numeric | null | undefined, fractionDigits = 0): string {
  if (value === null || value === undefined) return EMPTY_VALUE;
  const d = toDecimal(value);
  return `Rp ${numberFormatter(fractionDigits, fractionDigits).format(d.toNumber())}`;
}

/** Compact rupiah for KPI cards: "Rp 1,62 jt", "Rp 10,0 M". */
export function formatCurrencyCompact(value: Numeric | null | undefined): string {
  if (value === null || value === undefined) return EMPTY_VALUE;
  const d = toDecimal(value);
  const abs = d.abs();
  const sign = d.isNegative() ? '-' : '';

  const scale = (divisor: string, suffix: string): string =>
    `${sign}Rp ${numberFormatter(0, 2).format(abs.dividedBy(divisor).toNumber())} ${suffix}`;

  if (abs.greaterThanOrEqualTo('1e12')) return scale('1e12', 'T');
  if (abs.greaterThanOrEqualTo('1e9')) return scale('1e9', 'M');
  if (abs.greaterThanOrEqualTo('1e6')) return scale('1e6', 'jt');
  if (abs.greaterThanOrEqualTo('1e3')) return scale('1e3', 'rb');
  return formatCurrency(d);
}

export function formatQuantity(value: Numeric | null | undefined, maxDigits = 4): string {
  if (value === null || value === undefined) return EMPTY_VALUE;
  return numberFormatter(0, maxDigits).format(toDecimal(value).toNumber());
}

export function formatCoefficient(value: Numeric | null | undefined): string {
  if (value === null || value === undefined) return EMPTY_VALUE;
  return numberFormatter(0, 6).format(toDecimal(value).toNumber());
}

/**
 * Percentages are stored as 0..1 fractions and displayed as 0..100.
 * `formatPercent('0.1525')` → "15,25%".
 */
export function formatPercent(
  fraction: Numeric | null | undefined,
  fractionDigits = 2,
): string {
  if (fraction === null || fraction === undefined) return EMPTY_VALUE;
  const pct = toDecimal(fraction).times(100);
  return `${numberFormatter(fractionDigits, fractionDigits).format(pct.toNumber())}%`;
}

/** Same as `formatPercent` but always carries an explicit sign, for deviation. */
export function formatSignedPercent(
  fraction: Numeric | null | undefined,
  fractionDigits = 2,
): string {
  if (fraction === null || fraction === undefined) return EMPTY_VALUE;
  const d = toDecimal(fraction);
  const prefix = d.greaterThan(0) ? '+' : '';
  return `${prefix}${formatPercent(d, fractionDigits)}`;
}

export function formatRatio(value: Numeric | null | undefined, fractionDigits = 2): string {
  if (value === null || value === undefined) return EMPTY_VALUE;
  return numberFormatter(fractionDigits, fractionDigits).format(toDecimal(value).toNumber());
}

/**
 * Dates are stored as plain `date` strings ('YYYY-MM-DD') with no timezone, so
 * formatting is a pure string transform — no UTC drift is possible.
 */
export function formatDay(value: string | null | undefined, pattern = 'd MMM yyyy'): string {
  if (!value) return EMPTY_VALUE;
  return formatDate(parseISO(value), pattern, { locale: localeId });
}

export function formatDateTime(value: Date | null | undefined): string {
  if (!value) return EMPTY_VALUE;
  return formatDate(value, 'd MMM yyyy HH:mm', { locale: localeId });
}
