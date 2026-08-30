import { z } from 'zod';

import { optionalText, requiredText } from './common';
import { dayField, moneyField, percentField, quantityField } from './numeric';

/**
 * Piecework contracts, advances and certificates.
 *
 * Line amounts are absent from every schema here on purpose: they are derived
 * from quantity and rate in the service. A total that can be typed alongside
 * the two numbers it comes from is a total that will eventually contradict
 * them, and the contradiction is always found by whoever is owed money.
 */

const optionalDay = (label: string) =>
  z
    .union([z.string(), z.null(), z.undefined()])
    .transform((raw, ctx): string | null => {
      if (raw === null || raw === undefined || raw.trim() === '') return null;
      const parsed = dayField(label).safeParse(raw.trim());
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

export const subcontractFormSchema = z
  .object({
    partyName: requiredText('Nama mandor / subkon', 200),
    scope: optionalText(500),
    contractType: z.enum(['LUMPSUM', 'UNIT_RATE'], {
      message: 'Jenis kontrak wajib dipilih.',
    }),
    contractValue: moneyField('Nilai kontrak').default('0'),
    retentionPercent: percentField('Retensi'),
    startDate: optionalDay('Tanggal mulai'),
    endDate: optionalDay('Tanggal selesai'),
    status: z.enum(['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED'], {
      message: 'Status kontrak wajib dipilih.',
    }),
    note: optionalText(500),
    items: z
      .array(
        z.object({
          workItemId: z.string().trim().default(''),
          description: requiredText('Uraian pekerjaan', 300),
          qty: quantityField('Kuantitas'),
          unitId: z.string().trim().default(''),
          unitRate: moneyField('Harga satuan'),
        }),
      )
      .default([]),
  })
  .refine((v) => v.endDate === null || v.startDate === null || v.endDate >= v.startDate, {
    message: 'Tanggal selesai tidak boleh mendahului tanggal mulai.',
    path: ['endDate'],
  })
  /*
   * A unit-rate contract with no lines has no value at all — its worth is the
   * sum of its lines, and an empty sum is zero. A lump sum can legitimately
   * stand alone.
   */
  .refine((v) => v.contractType !== 'UNIT_RATE' || v.items.length > 0, {
    message: 'Kontrak harga satuan harus memuat setidaknya satu rincian.',
    path: ['items'],
  });

export type SubcontractFormInput = z.input<typeof subcontractFormSchema>;
export type SubcontractFormValues = z.output<typeof subcontractFormSchema>;

export const advanceFormSchema = z.object({
  advanceDate: dayField('Tanggal kasbon'),
  amount: moneyField('Nilai kasbon'),
  note: optionalText(300),
});

export type AdvanceFormValues = z.output<typeof advanceFormSchema>;

export const certificateFormSchema = z.object({
  periodId: z.string().uuid('Periode wajib dipilih.'),
  /*
   * Optional: blank asks the project's certificate series for the next number.
   * A certificate that arrives with the subcontractor's own reference on it
   * keeps that reference instead.
   */
  certNo: z.string().trim().max(60, 'Nomor sertifikat terlalu panjang.').default(''),
  certDate: dayField('Tanggal sertifikat'),
  advanceRecouped: moneyField('Potongan kasbon').default('0'),
  lines: z
    .array(
      z.object({
        subcontractItemId: z.string().uuid('Rincian kontrak wajib dipilih.'),
        qty: quantityField('Kuantitas diukur'),
      }),
    )
    .min(1, 'Sertifikat harus memuat setidaknya satu baris yang diukur.'),
});

export type CertificateFormValues = z.output<typeof certificateFormSchema>;

export const SUBCONTRACT_TYPE_LABELS = {
  LUMPSUM: 'Lumpsum',
  UNIT_RATE: 'Harga satuan',
} as const;

export const SUBCONTRACT_STATUS_LABELS = {
  DRAFT: 'Draf',
  ACTIVE: 'Berjalan',
  COMPLETED: 'Selesai',
  CANCELLED: 'Dibatalkan',
} as const;

export const CERTIFICATE_STATUS_LABELS = {
  DRAFT: 'Draf',
  APPROVED: 'Disetujui',
  PAID: 'Dibayar',
} as const;
