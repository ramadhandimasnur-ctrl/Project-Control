import { z } from 'zod';

import { optionalText } from './common';
import { dayField, quantityField } from './numeric';

/**
 * Form schemas for site progress.
 *
 * The method decides which field carries the answer, so the schema keeps both
 * and lets the service derive the other. Requiring both would make the form
 * ask the user to do arithmetic the system already does.
 */

const CHECKLIST_RESULTS = ['PASS', 'FAIL', 'NA'] as const;

export const CHECKLIST_LABELS: Record<(typeof CHECKLIST_RESULTS)[number], string> = {
  PASS: 'Sesuai',
  FAIL: 'Tidak sesuai',
  NA: 'Belum diperiksa',
};

export const CHECKLIST_ITEM_LABELS = {
  asDrawing: 'Sesuai gambar kerja',
  position: 'Posisi / elevasi',
  dimension: 'Dimensi',
} as const;

export const progressEntryFormSchema = z
  .object({
    method: z.enum(['VOLUME', 'PERCENT', 'MILESTONE']),
    qtyThisPeriod: z
      .union([quantityField('Kuantitas'), z.literal(''), z.null()])
      .default(null)
      .transform((v) => (v === '' || v === null || v === undefined ? null : String(v))),
    /** Typed as whole percent in the form; converted to a fraction here. */
    pctInput: z
      .union([z.coerce.number(), z.literal(''), z.null()])
      .default(null)
      .transform((v, ctx): string | null => {
        if (v === '' || v === null || v === undefined) return null;
        const value = Number(v);
        if (!Number.isFinite(value)) {
          ctx.addIssue({ code: 'custom', message: 'Persentase harus berupa angka.' });
          return z.NEVER;
        }
        if (value < 0 || value > 100) {
          ctx.addIssue({ code: 'custom', message: 'Persentase harus antara 0 dan 100.' });
          return z.NEVER;
        }
        return String(value / 100);
      }),
    entryDate: dayField('Tanggal catat'),
    /*
     * Where on site this was measured. Kept apart from the note rather than
     * folded into it, because it is the field an opname argument turns on and
     * a free-text note is where such things go to be lost.
     */
    location: optionalText(200),
    note: optionalText(500),
  })
  .refine((v) => (v.method === 'VOLUME' ? v.qtyThisPeriod !== null : v.pctInput !== null), {
    message: 'Isi capaian periode ini.',
    path: ['qtyThisPeriod'],
  });

export type ProgressEntryFormInput = z.input<typeof progressEntryFormSchema>;
export type ProgressEntryFormValues = z.output<typeof progressEntryFormSchema>;

export const checklistFormSchema = z.object({
  asDrawing: z.enum(CHECKLIST_RESULTS).default('NA'),
  position: z.enum(CHECKLIST_RESULTS).default('NA'),
  dimension: z.enum(CHECKLIST_RESULTS).default('NA'),
  checkedAt: z
    .union([dayField('Tanggal periksa'), z.literal(''), z.null()])
    .default(null)
    .transform((v) => (v === '' || v === null || v === undefined ? null : v)),
  note: optionalText(500),
});

export type ChecklistFormInput = z.input<typeof checklistFormSchema>;
