import { z } from 'zod';

import { codeField, optionalText, requiredText } from './common';
import { dayField, moneyField, quantityField } from './numeric';

/**
 * Day-rate labour and the foreman master behind it.
 *
 * Person-days and the gross are absent from both schemas on purpose: they are
 * headcount times day-fraction times rate, and the service computes them. A
 * form that let all of them be typed would eventually hold numbers that do not
 * multiply out, and the one a foreman is paid on is whichever they read first.
 */

export const foremanFormSchema = z.object({
  code: codeField('Kode mandor'),
  name: requiredText('Nama mandor', 200),
  phone: optionalText(40),
  address: optionalText(300),
  /*
   * The reason the master record exists at all: looking this up from a
   * WhatsApp thread every payday is how money reaches the wrong account.
   */
  bankAccount: optionalText(60),
  isActive: z.coerce.boolean().default(true),
  note: optionalText(300),
});

export type ForemanFormInput = z.input<typeof foremanFormSchema>;
export type ForemanFormValues = z.output<typeof foremanFormSchema>;

export const FOREMAN_FORM_DEFAULTS = {
  code: '',
  name: '',
  phone: '',
  address: '',
  bankAccount: '',
  isActive: true,
  note: '',
} satisfies ForemanFormInput;

export const dailyLaborFormSchema = z.object({
  workDate: dayField('Tanggal kerja'),
  periodId: z.string().trim().default(''),
  foremanId: z.string().trim().default(''),
  workerCount: z.coerce
    .number({ message: 'Jumlah pekerja harus berupa angka.' })
    .int('Jumlah pekerja dihitung per orang.')
    .min(1, 'Jumlah pekerja minimal satu.')
    .max(999, 'Jumlah pekerja terlalu besar.'),
  /*
   * A fraction of a day, not hours. Rain stops work at noon and a crew arrives
   * late; 0,5625 is four and a half hours of eight, which is the kind of figure
   * a real attendance book carries. Capped at one because a longer day is
   * overtime and belongs on its own rate.
   */
  dayFraction: quantityField('Bagian hari')
    .refine((v) => Number(v) > 0, { message: 'Bagian hari harus lebih dari nol.' })
    .refine((v) => Number(v) <= 1, {
      message: 'Lebih dari satu hari penuh dicatat sebagai lembur pada tarif tersendiri.',
    }),
  dailyRate: moneyField('Tarif harian'),
  note: optionalText(300),
  lines: z
    .array(
      z.object({
        workItemId: z.string().trim().default(''),
        personDays: quantityField('Hari-orang'),
        qtyOutput: z
          .union([z.string(), z.number(), z.null(), z.undefined()])
          .transform((raw): string | null => {
            if (raw === null || raw === undefined) return null;
            const text = typeof raw === 'number' ? String(raw) : raw.trim();
            return text === '' ? null : text;
          })
          .optional()
          .transform((v) => v ?? null),
        note: optionalText(200),
      }),
    )
    .default([]),
});

export type DailyLaborFormInput = z.input<typeof dailyLaborFormSchema>;
export type DailyLaborFormValues = z.output<typeof dailyLaborFormSchema>;

export const DAILY_LABOR_FORM_DEFAULTS = {
  workDate: '',
  periodId: '',
  foremanId: '',
  workerCount: 1,
  dayFraction: '1',
  dailyRate: '',
  note: '',
  lines: [],
} satisfies DailyLaborFormInput;

export const DAILY_LABOR_STATUS_LABELS = {
  DRAFT: 'Draf',
  APPROVED: 'Disetujui',
  PAID: 'Dibayar',
} as const;

/**
 * The fractions people actually write down.
 *
 * Offered as a list because typing 0,5625 correctly is harder than choosing
 * "4,5 jam", and a mistyped fraction is a mistyped wage.
 */
export const DAY_FRACTION_OPTIONS = [
  { value: '1', label: '1 hari penuh (8 jam)' },
  { value: '0.875', label: '7 jam' },
  { value: '0.75', label: '6 jam' },
  { value: '0.625', label: '5 jam' },
  { value: '0.5625', label: '4,5 jam' },
  { value: '0.5', label: 'setengah hari (4 jam)' },
  { value: '0.375', label: '3 jam' },
  { value: '0.25', label: '2 jam' },
] as const;
