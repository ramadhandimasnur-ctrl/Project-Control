import { z } from 'zod';

import { optionalText, requiredText } from './common';
import { dayField, quantityField } from './numeric';

/**
 * Form schema for a change order.
 *
 * A revision with no lines is refused rather than saved empty: an addendum
 * that changes nothing is a document nobody can act on, and it would still
 * consume a CCO number that the paperwork expects to mean something.
 */
export const revisionFormSchema = z.object({
  title: requiredText('Judul revisi', 200),
  reason: optionalText(1000),
  effectiveDate: dayField('Tanggal berlaku'),
  /*
   * Days the addendum adds to the contract. Negative shortens it, which is
   * what removing work can legitimately do. Bounded at five years either way
   * so a slipped decimal cannot silently move a finish date to 2190.
   */
  scheduleImpactDays: z.coerce
    .number({ message: 'Perpanjangan waktu harus berupa angka hari.' })
    .int('Perpanjangan waktu dihitung dalam hari penuh.')
    .min(-1825, 'Percepatan tidak boleh lebih dari 1825 hari.')
    .max(1825, 'Perpanjangan tidak boleh lebih dari 1825 hari.')
    .default(0),
  lines: z
    .array(
      z.object({
        workItemId: z.string().uuid('Pekerjaan wajib dipilih.'),
        volumeAfter: quantityField('Volume setelah revisi'),
        note: optionalText(300),
      }),
    )
    .min(1, 'Pilih setidaknya satu pekerjaan yang berubah.'),
});

export type RevisionFormInput = z.input<typeof revisionFormSchema>;
export type RevisionFormValues = z.output<typeof revisionFormSchema>;

export const REVISION_KIND_LABELS = {
  ADD: 'Tambah',
  CHANGE: 'Ubah volume',
  REMOVE: 'Kurang / nol',
} as const;
