import { z } from 'zod';

import { Decimal, toDecimal } from '@/lib/calc/decimal';

/**
 * Zod fields for the four numeric scales.
 *
 * Values arrive from forms as strings and leave as strings at the exact scale
 * of their Postgres column, so nothing ever passes through a JS float. Error
 * messages are in Indonesian and name the field (charter rule 12).
 */

type DecimalFieldOptions = {
  label: string;
  scale: number;
  min?: string;
  max?: string;
  allowNegative?: boolean;
};

function decimalField(options: DecimalFieldOptions) {
  const { label, scale, min, max, allowNegative = false } = options;

  return z.union([z.string(), z.number()]).transform((raw, ctx): string => {
    const text = typeof raw === 'number' ? String(raw) : raw.trim();

    if (text === '') {
      ctx.addIssue({ code: 'custom', message: `${label} wajib diisi.` });
      return z.NEVER;
    }

    let value: Decimal;
    try {
      value = toDecimal(text);
    } catch {
      ctx.addIssue({ code: 'custom', message: `${label} harus berupa angka.` });
      return z.NEVER;
    }

    if (!allowNegative && value.isNegative()) {
      ctx.addIssue({ code: 'custom', message: `${label} tidak boleh negatif.` });
      return z.NEVER;
    }
    if (min !== undefined && value.lessThan(min)) {
      ctx.addIssue({ code: 'custom', message: `${label} minimal ${min}.` });
      return z.NEVER;
    }
    if (max !== undefined && value.greaterThan(max)) {
      ctx.addIssue({ code: 'custom', message: `${label} maksimal ${max}.` });
      return z.NEVER;
    }

    return value.toDecimalPlaces(scale, Decimal.ROUND_HALF_UP).toFixed(scale);
  });
}

export const moneyField = (label: string) => decimalField({ label, scale: 2 });

export const quantityField = (label: string) => decimalField({ label, scale: 4 });

export const coefficientField = (label: string) => decimalField({ label, scale: 6 });

/**
 * A percentage as the user types it — 0..100 — converted to the 0..1 fraction
 * the database stores. `5` becomes `"0.050000"`.
 */
export const percentField = (label: string) =>
  z.union([z.string(), z.number()]).transform((raw, ctx): string => {
    const text = typeof raw === 'number' ? String(raw) : raw.trim();
    if (text === '') {
      ctx.addIssue({ code: 'custom', message: `${label} wajib diisi.` });
      return z.NEVER;
    }

    let value: Decimal;
    try {
      value = toDecimal(text);
    } catch {
      ctx.addIssue({ code: 'custom', message: `${label} harus berupa angka.` });
      return z.NEVER;
    }

    if (value.isNegative() || value.greaterThan(100)) {
      ctx.addIssue({ code: 'custom', message: `${label} harus antara 0 dan 100.` });
      return z.NEVER;
    }

    return value.dividedBy(100).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6);
  });

/**
 * A deviation threshold, entered as a negative percentage such as -0.5,
 * stored as the fraction -0.005.
 */
export const thresholdField = (label: string) =>
  z.union([z.string(), z.number()]).transform((raw, ctx): string => {
    const text = typeof raw === 'number' ? String(raw) : raw.trim();
    if (text === '') {
      ctx.addIssue({ code: 'custom', message: `${label} wajib diisi.` });
      return z.NEVER;
    }

    let value: Decimal;
    try {
      value = toDecimal(text);
    } catch {
      ctx.addIssue({ code: 'custom', message: `${label} harus berupa angka.` });
      return z.NEVER;
    }

    if (value.greaterThan(0) || value.lessThan(-100)) {
      ctx.addIssue({
        code: 'custom',
        message: `${label} harus berupa persentase negatif, misalnya -0,5.`,
      });
      return z.NEVER;
    }

    return value.dividedBy(100).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6);
  });

/** A calendar date in 'YYYY-MM-DD' form, matching the `date` columns. */
export const dayField = (label: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} harus berupa tanggal yang valid.`)
    .refine((v) => !Number.isNaN(Date.parse(v)), `${label} harus berupa tanggal yang valid.`);
