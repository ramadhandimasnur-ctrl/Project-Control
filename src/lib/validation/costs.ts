import { z } from 'zod';

import { dayField, moneyField, quantityField } from './numeric';
import { optionalText } from './common';

/**
 * A cost booked against a work item.
 *
 * Either the total is typed, or a quantity and a unit price are — the service
 * derives the one from the other. Both shapes occur in the field: a day's
 * labour arrives as a total, plant hire as a rate times days, and forcing
 * either into the other means somebody multiplies in their head.
 */

const optionalMoneyOrNull = (label: string) =>
  z
    .union([z.string(), z.number(), z.null(), z.undefined()])
    .transform((raw, ctx): string | null => {
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
    })
    .optional()
    .transform((v) => v ?? null);

const optionalQtyOrNull = (label: string) =>
  z
    .union([z.string(), z.number(), z.null(), z.undefined()])
    .transform((raw, ctx): string | null => {
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
    })
    .optional()
    .transform((v) => v ?? null);

export const actualCostFormSchema = z
  .object({
    costDate: dayField('Tanggal biaya'),
    /*
     * Blank is allowed and means "the project, not one item". A site overhead
     * belongs to no single work item, and making somebody choose one produces
     * a wrong attribution rather than an honest blank.
     */
    workItemId: z.string().trim().default(''),
    resourceId: z.string().trim().default(''),
    category: z.enum(['LABOR', 'MATERIAL', 'EQUIPMENT', 'SUBCON', 'PACKAGE'], {
      message: 'Kategori biaya wajib dipilih.',
    }),
    qty: optionalQtyOrNull('Kuantitas'),
    unitCost: optionalMoneyOrNull('Harga satuan'),
    amount: optionalMoneyOrNull('Jumlah'),
    sourceRef: optionalText(120),
    note: optionalText(300),
  })
  .refine((v) => v.amount !== null || (v.qty !== null && v.unitCost !== null), {
    message: 'Isi jumlahnya, atau isi kuantitas dan harga satuan.',
    path: ['amount'],
  });

export type ActualCostFormInput = z.input<typeof actualCostFormSchema>;
export type ActualCostFormValues = z.output<typeof actualCostFormSchema>;

export const ACTUAL_COST_FORM_DEFAULTS = {
  costDate: '',
  workItemId: '',
  resourceId: '',
  category: 'LABOR',
  qty: '',
  unitCost: '',
  amount: '',
  sourceRef: '',
  note: '',
} satisfies ActualCostFormInput;

export const COST_CATEGORY_LABELS = {
  LABOR: 'Tenaga',
  MATERIAL: 'Bahan',
  EQUIPMENT: 'Alat',
  SUBCON: 'Subkon',
  PACKAGE: 'Paket',
} as const;
