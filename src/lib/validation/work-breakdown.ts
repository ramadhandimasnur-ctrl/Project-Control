import { z } from 'zod';

import { coefficientField, moneyField, percentField, quantityField } from './numeric';

/**
 * Form schemas for the work breakdown and the unit-rate analysis.
 */

import {
  codeField as code,
  optionalId,
  optionalText,
  requiredId,
  requiredText as name,
} from './common';

// --- work group -------------------------------------------------------------

export const workGroupFormSchema = z.object({
  code: code('Kode kelompok', 16),
  name: name('Nama kelompok'),
  parentId: optionalId(),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
});

export type WorkGroupFormInput = z.input<typeof workGroupFormSchema>;
export type WorkGroupFormValues = z.output<typeof workGroupFormSchema>;

export const WORK_GROUP_FORM_DEFAULTS = {
  code: '',
  name: '',
  parentId: '',
  sortOrder: 0,
} satisfies WorkGroupFormInput;

// --- work item --------------------------------------------------------------

/**
 * `contractUnitPrice` may legitimately be absent — the estimate then falls back
 * to RAB plus markup — so the empty field becomes null rather than zero. Zero
 * is a different statement: a line that is genuinely not billed separately.
 */
const optionalMoney = (label: string) =>
  z.union([z.string(), z.number(), z.null(), z.undefined()]).transform((raw, ctx): string | null => {
    if (raw === null || raw === undefined) return null;
    const text = typeof raw === 'number' ? String(raw) : raw.trim();
    if (text === '') return null;

    const parsed = moneyField(label).safeParse(text);
    if (!parsed.success) {
      ctx.addIssue({ code: 'custom', message: parsed.error.issues[0]?.message ?? `${label} tidak valid.` });
      return z.NEVER;
    }
    return parsed.data;
  });

/**
 * A quantity that may legitimately be absent.
 *
 * Blank becomes null, which for the execution volume means "the same as the
 * contracted one" — a different statement from zero, which would be a line
 * nobody plans to build.
 */
const optionalQuantity = (label: string) =>
  z.union([z.string(), z.number(), z.null(), z.undefined()]).transform((raw, ctx): string | null => {
    if (raw === null || raw === undefined) return null;
    const text = typeof raw === 'number' ? String(raw) : raw.trim();
    if (text === '') return null;

    const parsed = quantityField(label).safeParse(text);
    if (!parsed.success) {
      ctx.addIssue({
        code: 'custom',
        message: parsed.error.issues[0]?.message ?? `${label} tidak valid.`,
      });
      return z.NEVER;
    }
    return parsed.data;
  });

export const workItemFormSchema = z.object({
  code: code('Kode pekerjaan'),
  name: name('Uraian pekerjaan'),
  spec: optionalText(500),
  groupId: optionalId(),
  unitId: requiredId('Satuan'),
  volume: quantityField('Volume'),
  /** Blank follows the contracted volume; see the column comment on work_items. */
  volumeRap: optionalQuantity('Volume RAP'),
  contractUnitPrice: optionalMoney('Harga satuan kontrak'),
  /*
   * Prices typed straight onto the work item, for lines with no AHSP. Blank
   * means "no direct price", which is different from zero — zero is a line
   * genuinely costed at nothing.
   */
  unitPriceRab: optionalMoney('Harga RAB'),
  unitPriceRap: optionalMoney('Harga RAP'),
  priceMarkupPercent: z
    .union([z.string(), z.number(), z.null(), z.undefined()])
    .transform((raw, ctx): string | null => {
      if (raw === null || raw === undefined) return null;
      const text = typeof raw === 'number' ? String(raw) : raw.trim();
      if (text === '') return null;

      const value = Number(text);
      if (!Number.isFinite(value) || value < 0 || value > 1000) {
        ctx.addIssue({ code: 'custom', message: 'Markup harus antara 0 dan 1000%.' });
        return z.NEVER;
      }
      return text;
    }),
  progressMethod: z.enum(['VOLUME', 'PERCENT', 'MILESTONE'], {
    message: 'Metode progres wajib dipilih.',
  }),
  includeInProgressWeight: z.boolean(),
  sortOrder: z.coerce.number().int().min(0).max(99999).default(0),
});

export type WorkItemFormInput = z.input<typeof workItemFormSchema>;
export type WorkItemFormValues = z.output<typeof workItemFormSchema>;

export const WORK_ITEM_FORM_DEFAULTS = {
  code: '',
  name: '',
  spec: '',
  groupId: '',
  unitId: '',
  volume: '0',
  volumeRap: '',
  contractUnitPrice: '',
  unitPriceRab: '',
  unitPriceRap: '',
  priceMarkupPercent: '',
  progressMethod: 'VOLUME',
  includeInProgressWeight: true,
  sortOrder: 0,
} satisfies WorkItemFormInput;

// --- volume take-off --------------------------------------------------------

export const takeoffFormSchema = z.object({
  label: name('Uraian', 200),
  expression: optionalText(200),
  qty: quantityField('Kuantitas'),
  note: optionalText(300),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
});

export type TakeoffFormInput = z.input<typeof takeoffFormSchema>;
export type TakeoffFormValues = z.output<typeof takeoffFormSchema>;

export const TAKEOFF_FORM_DEFAULTS = {
  label: '',
  expression: '',
  qty: '0',
  note: '',
  sortOrder: 0,
} satisfies TakeoffFormInput;

// --- AHSP line --------------------------------------------------------------

export const ahspLineFormSchema = z
  .object({
    resourceId: requiredId('Sumber daya'),
    estimateType: z.enum(['RAB', 'RAP'], { message: 'Jenis analisa wajib dipilih.' }),
    role: z.enum(['LABOR', 'MATERIAL', 'EQUIPMENT', 'SUBCON', 'PACKAGE'], {
      message: 'Bagian analisa wajib dipilih.',
    }),
    coef: coefficientField('Koefisien'),
    wasteFactor: percentField('Faktor susut'),
    note: optionalText(300),
    sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
  })
  // A line contributing nothing is almost always a half-finished entry rather
  // than a deliberate zero.
  .refine((v) => Number(v.coef) > 0, {
    message: 'Koefisien harus lebih besar dari nol.',
    path: ['coef'],
  });

export type AhspLineFormInput = z.input<typeof ahspLineFormSchema>;
export type AhspLineFormValues = z.output<typeof ahspLineFormSchema>;

export const AHSP_LINE_FORM_DEFAULTS = {
  resourceId: '',
  estimateType: 'RAB',
  role: 'MATERIAL',
  coef: '0',
  wasteFactor: '0',
  note: '',
  sortOrder: 0,
} satisfies AhspLineFormInput;

export const ESTIMATE_TYPE_LABELS = {
  RAB: 'AHSP RAB',
  RAP: 'AHSP RAP',
} as const;

export const ESTIMATE_TYPE_CAPTIONS = {
  RAB: 'Analisa anggaran: dasar nilai pekerjaan dan bobot.',
  RAP: 'Analisa pelaksanaan: dasar biaya, pengadaan, dan margin.',
} as const;

// --- template & duplication -------------------------------------------------

export const templateFormSchema = z.object({
  code: code('Kode template', 32),
  name: name('Nama template', 200),
  notes: optionalText(1000),
});

export type TemplateFormInput = z.input<typeof templateFormSchema>;
export type TemplateFormValues = z.output<typeof templateFormSchema>;

export const TEMPLATE_FORM_DEFAULTS = {
  code: '',
  name: '',
  notes: '',
} satisfies TemplateFormInput;

export const applyTemplateSchema = z.object({
  templateId: z.string().uuid('Template wajib dipilih.'),
  mode: z.enum(['APPEND', 'REPLACE'], { message: 'Cara penerapan wajib dipilih.' }),
});

export type ApplyTemplateInput = z.input<typeof applyTemplateSchema>;
export type ApplyTemplateValues = z.output<typeof applyTemplateSchema>;

export const duplicateWorkItemSchema = z.object({
  code: code('Kode pekerjaan baru'),
  name: name('Uraian pekerjaan baru'),
  includeTakeoffs: z.boolean(),
});

export type DuplicateWorkItemInput = z.input<typeof duplicateWorkItemSchema>;
export type DuplicateWorkItemValues = z.output<typeof duplicateWorkItemSchema>;

export const AHSP_ROLE_LABELS = {
  LABOR: 'A. Tenaga',
  MATERIAL: 'B. Bahan',
  EQUIPMENT: 'C. Alat',
  SUBCON: 'D. Subkon',
  PACKAGE: 'E. Paket',
} as const;

export const AHSP_ROLE_ORDER = ['LABOR', 'MATERIAL', 'EQUIPMENT', 'SUBCON', 'PACKAGE'] as const;
