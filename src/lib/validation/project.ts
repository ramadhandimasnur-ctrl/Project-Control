import { z } from 'zod';

import { PROJECT_ROLES } from '@/lib/auth/roles';

import { dayField, moneyField, percentField, thresholdField } from './numeric';

const requiredText = (label: string, max = 200) =>
  z
    .string()
    .trim()
    .min(1, `${label} wajib diisi.`)
    .max(max, `${label} maksimal ${max} karakter.`);

const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === undefined || v === '' ? null : v));

export const projectFormSchema = z
  .object({
    code: requiredText('Kode proyek', 32).regex(
      /^[A-Za-z0-9._-]+$/,
      'Kode proyek hanya boleh berisi huruf, angka, titik, garis bawah, dan tanda hubung.',
    ),
    name: requiredText('Nama proyek'),

    contractNo: optionalText(100),
    ownerName: optionalText(200),
    contractorName: optionalText(200),
    location: optionalText(300),
    projectType: optionalText(100),

    contractValue: moneyField('Nilai kontrak'),

    startDate: dayField('Tanggal mulai'),
    endDate: dayField('Tanggal selesai'),
    periodType: z.enum(['DAY', 'WEEK', 'MONTH']),
    durationUnit: z.enum(['DAY', 'WEEK', 'MONTH']).default('DAY'),

    retentionPercent: percentField('Retensi'),
    retentionReleaseDays: z.coerce
      .number()
      .int('Masa retensi harus berupa bilangan bulat.')
      .min(0, 'Masa retensi tidak boleh negatif.')
      .max(3650, 'Masa retensi terlalu panjang.'),
    vatPercent: percentField('PPN'),
    whtPercent: percentField('PPh'),

    progressWeightBasis: z.enum(['CONTRACT', 'RAB', 'RAP']),
    costRecognition: z.enum(['PURCHASE_BASED', 'CONSUMPTION_BASED']),
    defaultMarkup: percentField('Markup default'),

    thresholdWarning: thresholdField('Ambang peringatan'),
    thresholdDelayed: thresholdField('Ambang terlambat'),

    requireChecklistBeforeApprove: z.boolean(),
    allowNegativeStock: z.boolean(),

    status: z.enum(['DRAFT', 'ACTIVE', 'ON_HOLD', 'CLOSED']),
    notes: optionalText(2000),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: 'Tanggal selesai harus sama dengan atau setelah tanggal mulai.',
    path: ['endDate'],
  })
  // A warning threshold stricter than the delayed threshold would make
  // 'WARNING' unreachable, so the status chip could never show it.
  .refine((v) => Number(v.thresholdWarning) >= Number(v.thresholdDelayed), {
    message: 'Ambang peringatan harus lebih longgar daripada ambang terlambat.',
    path: ['thresholdWarning'],
  });

export type ProjectFormInput = z.input<typeof projectFormSchema>;
export type ProjectFormValues = z.output<typeof projectFormSchema>;

export const projectMemberSchema = z.object({
  userId: z.string().uuid('Pengguna tidak valid.'),
  role: z.enum(PROJECT_ROLES),
});

export type ProjectMemberValues = z.output<typeof projectMemberSchema>;

/** Sensible starting point for the "new project" form. */
export const PROJECT_FORM_DEFAULTS = {
  code: '',
  name: '',
  contractNo: '',
  ownerName: '',
  contractorName: '',
  location: '',
  projectType: '',
  contractValue: '0',
  startDate: '',
  endDate: '',
  periodType: 'WEEK',
  durationUnit: 'DAY',
  // Charter rule 13: no tax or retention rate is hardcoded. These start at
  // zero and are entered per project; only the deviation thresholds carry the
  // defaults the charter itself specifies.
  retentionPercent: '0',
  retentionReleaseDays: 0,
  vatPercent: '0',
  whtPercent: '0',
  progressWeightBasis: 'CONTRACT',
  costRecognition: 'PURCHASE_BASED',
  defaultMarkup: '0',
  thresholdWarning: '-0.5',
  thresholdDelayed: '-5',
  requireChecklistBeforeApprove: true,
  allowNegativeStock: false,
  status: 'DRAFT',
  notes: '',
} satisfies ProjectFormInput;
