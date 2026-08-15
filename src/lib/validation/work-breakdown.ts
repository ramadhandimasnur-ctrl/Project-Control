import { z } from 'zod';

import { coefficientField, moneyField, percentField, quantityField } from './numeric';

/**
 * Form schemas for the work breakdown and the unit-rate analysis.
 */

const code = (label: string, max = 32) =>
  z
    .string()
    .trim()
    .min(1, `${label} wajib diisi.`)
    .max(max, `${label} maksimal ${max} karakter.`)
    .regex(
      /^[A-Za-z0-9._/-]+$/,
      `${label} hanya boleh berisi huruf, angka, titik, garis miring, garis bawah, dan tanda hubung.`,
    );

const name = (label: string, max = 300) =>
  z.string().trim().min(1, `${label} wajib diisi.`).max(max, `${label} maksimal ${max} karakter.`);

const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max, `Maksimal ${max} karakter.`)
    .optional()
    .transform((v) => (v === undefined || v === '' ? null : v));

const optionalId = () =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' || v === '__none__' ? null : v));

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
  z.union([z.string(), z.number()]).transform((raw, ctx): string | null => {
    const text = typeof raw === 'number' ? String(raw) : raw.trim();
    if (text === '') return null;

    const parsed = moneyField(label).safeParse(text);
    if (!parsed.success) {
      ctx.addIssue({ code: 'custom', message: parsed.error.issues[0]?.message ?? `${label} tidak valid.` });
      return z.NEVER;
    }
    return parsed.data;
  });

export const workItemFormSchema = z.object({
  code: code('Kode pekerjaan'),
  name: name('Uraian pekerjaan'),
  spec: optionalText(500),
  groupId: optionalId(),
  unitId: z.string().uuid('Satuan wajib dipilih.'),
  volume: quantityField('Volume'),
  contractUnitPrice: optionalMoney('Harga satuan kontrak'),
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
  contractUnitPrice: '',
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
    resourceId: z.string().uuid('Sumber daya wajib dipilih.'),
    role: z.enum(['LABOR', 'MATERIAL', 'EQUIPMENT', 'SUBCON', 'PACKAGE'], {
      message: 'Bagian analisa wajib dipilih.',
    }),
    coefRab: coefficientField('Koefisien RAB'),
    coefRap: coefficientField('Koefisien RAP'),
    wasteFactor: percentField('Faktor susut'),
    note: optionalText(300),
    sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
  })
  // A line contributing nothing to either estimate is almost always a
  // half-finished entry rather than a deliberate zero.
  .refine((v) => Number(v.coefRab) > 0 || Number(v.coefRap) > 0, {
    message: 'Setidaknya satu koefisien harus lebih besar dari nol.',
    path: ['coefRap'],
  });

export type AhspLineFormInput = z.input<typeof ahspLineFormSchema>;
export type AhspLineFormValues = z.output<typeof ahspLineFormSchema>;

export const AHSP_LINE_FORM_DEFAULTS = {
  resourceId: '',
  role: 'MATERIAL',
  coefRab: '0',
  coefRap: '0',
  wasteFactor: '0',
  note: '',
  sortOrder: 0,
} satisfies AhspLineFormInput;

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
