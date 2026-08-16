import { z } from 'zod';

import { coefficientField, dayField, moneyField } from './numeric';

/**
 * Form schemas for the organisation catalogue.
 *
 * Charter section 7 asks for validation in three places. This is the first:
 * what the user typed. The service checks the rules that need other rows to
 * decide (uniqueness, whether a unit is already in use), and the database
 * holds the constraints that must be true no matter who writes.
 */

const RESOURCE_TYPES = ['LABOR', 'MATERIAL', 'EQUIPMENT', 'SUBCON', 'PACKAGE', 'OVERHEAD'] as const;
const UNIT_DIMENSIONS = ['LENGTH', 'AREA', 'VOLUME', 'MASS', 'COUNT', 'TIME', 'LUMPSUM'] as const;

import {
  codeField as code,
  daysField as days,
  optionalId,
  optionalText,
  requiredId,
  requiredText as name,
} from './common';

// --- resource ---------------------------------------------------------------

export const resourceFormSchema = z.object({
  code: code('Kode'),
  name: name('Nama'),
  spec: optionalText(300),
  type: z.enum(RESOURCE_TYPES, { message: 'Jenis wajib dipilih.' }),
  unitId: requiredId('Satuan'),
  categoryId: optionalId(),
  leadTimeDays: days('Lead time'),
  notes: optionalText(1000),
});

export type ResourceFormInput = z.input<typeof resourceFormSchema>;
export type ResourceFormValues = z.output<typeof resourceFormSchema>;

export const RESOURCE_FORM_DEFAULTS = {
  code: '',
  name: '',
  spec: '',
  type: 'MATERIAL',
  unitId: '',
  categoryId: '',
  leadTimeDays: 0,
  notes: '',
} satisfies ResourceFormInput;

// --- category ---------------------------------------------------------------

export const categoryFormSchema = z.object({
  code: code('Kode kategori', 32),
  name: name('Nama kategori', 150),
  type: z.enum(RESOURCE_TYPES, { message: 'Jenis wajib dipilih.' }),
  /** Empty means a top-level category rather than an unset field. */
  parentId: optionalId(),
});

export type CategoryFormInput = z.input<typeof categoryFormSchema>;
export type CategoryFormValues = z.output<typeof categoryFormSchema>;

export const CATEGORY_FORM_DEFAULTS = {
  code: '',
  name: '',
  type: 'MATERIAL',
  parentId: '',
} satisfies CategoryFormInput;

// --- unit -------------------------------------------------------------------

export const unitFormSchema = z
  .object({
    code: code('Kode satuan', 16),
    name: name('Nama satuan', 100),
    dimension: z.enum(UNIT_DIMENSIONS, { message: 'Dimensi wajib dipilih.' }),
    baseUnitId: optionalId(),
    factorToBase: coefficientField('Faktor konversi'),
  })
  .refine((v) => Number(v.factorToBase) > 0, {
    message: 'Faktor konversi harus lebih besar dari nol.',
    path: ['factorToBase'],
  })
  // A factor only means something relative to a base unit.
  .refine((v) => v.baseUnitId !== null || Number(v.factorToBase) === 1, {
    message: 'Faktor selain 1 hanya berlaku bila satuan dasar dipilih.',
    path: ['factorToBase'],
  });

export type UnitFormInput = z.input<typeof unitFormSchema>;
export type UnitFormValues = z.output<typeof unitFormSchema>;

export const UNIT_FORM_DEFAULTS = {
  code: '',
  name: '',
  dimension: 'COUNT',
  baseUnitId: '',
  factorToBase: '1',
} satisfies UnitFormInput;

// --- supplier ---------------------------------------------------------------

export const supplierFormSchema = z.object({
  code: code('Kode pemasok', 24),
  name: name('Nama pemasok'),
  contact: optionalText(200),
  address: optionalText(400),
  creditDays: days('Termin kredit'),
  note: optionalText(1000),
});

export type SupplierFormInput = z.input<typeof supplierFormSchema>;
export type SupplierFormValues = z.output<typeof supplierFormSchema>;

export const SUPPLIER_FORM_DEFAULTS = {
  code: '',
  name: '',
  contact: '',
  address: '',
  creditDays: 0,
  note: '',
} satisfies SupplierFormInput;

// --- price ------------------------------------------------------------------

export const priceFormSchema = z.object({
  priceType: z.enum(['RAB', 'RAP'], { message: 'Jenis harga wajib dipilih.' }),
  price: moneyField('Harga'),
  effectiveFrom: dayField('Tanggal berlaku'),
  source: optionalText(200),
  note: optionalText(500),
});

export type PriceFormInput = z.input<typeof priceFormSchema>;
export type PriceFormValues = z.output<typeof priceFormSchema>;

export const PRICE_FORM_DEFAULTS = {
  priceType: 'RAP',
  price: '0',
  effectiveFrom: '',
  source: '',
  note: '',
} satisfies PriceFormInput;

/**
 * Both prices in one submission.
 *
 * Either may be left blank, which means "leave that one alone" rather than
 * "set it to zero" — a price of nothing and no price at all are different
 * statements, and the estimate treats them differently.
 */
const optionalPrice = (label: string) =>
  z.union([z.string(), z.number(), z.null(), z.undefined()]).transform((raw, ctx): string | null => {
    if (raw === null || raw === undefined) return null;
    const text = typeof raw === 'number' ? String(raw) : raw.trim();
    if (text === '') return null;

    const parsed = moneyField(label).safeParse(text);
    if (!parsed.success) {
      ctx.addIssue({
        code: 'custom',
        message: parsed.error.issues[0]?.message ?? `${label} tidak valid.`,
      });
      return z.NEVER;
    }
    return parsed.data;
  });

/** Percentage as typed, e.g. "15" for 15%. Blank means no markup is kept. */
const optionalMarkup = z
  .union([z.string(), z.number(), z.null(), z.undefined()])
  .transform((raw, ctx): string | null => {
    if (raw === null || raw === undefined) return null;
    const text = typeof raw === 'number' ? String(raw) : raw.trim();
    if (text === '') return null;

    const value = Number(text);
    if (!Number.isFinite(value)) {
      ctx.addIssue({ code: 'custom', message: 'Markup harus berupa angka.' });
      return z.NEVER;
    }
    if (value < 0) {
      ctx.addIssue({ code: 'custom', message: 'Markup tidak boleh negatif.' });
      return z.NEVER;
    }
    if (value > 1000) {
      ctx.addIssue({ code: 'custom', message: 'Markup maksimal 1000%.' });
      return z.NEVER;
    }
    return text;
  });

export const pricePairFormSchema = z
  .object({
    priceRap: optionalPrice('Harga RAP'),
    priceRab: optionalPrice('Harga RAB'),
    markupPercent: optionalMarkup,
    effectiveFrom: dayField('Tanggal berlaku'),
    source: optionalText(200),
    note: optionalText(500),
  })
  .refine((v) => v.priceRap !== null || v.priceRab !== null, {
    message: 'Isi setidaknya salah satu harga.',
    path: ['priceRap'],
  });

export type PricePairFormInput = z.input<typeof pricePairFormSchema>;
export type PricePairFormValues = z.output<typeof pricePairFormSchema>;

export const PRICE_PAIR_FORM_DEFAULTS = {
  priceRap: '',
  priceRab: '',
  markupPercent: '',
  effectiveFrom: '',
  source: '',
  note: '',
} satisfies PricePairFormInput;
