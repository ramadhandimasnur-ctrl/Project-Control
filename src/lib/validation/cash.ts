import { z } from 'zod';

import { optionalText, requiredText } from './common';
import { dayField, moneyField } from './numeric';

/**
 * Form schemas for project money.
 *
 * Percentages are typed as whole numbers because that is how a contract states
 * them — "termin 30%" — and converted to the 0..1 fraction the columns store at
 * this boundary, so nothing downstream has to guess which scale a figure is on.
 */

const percentInput = (label: string, max = 100) =>
  z
    .union([z.coerce.number(), z.literal(''), z.null()])
    .default(null)
    .transform((v, ctx): string | null => {
      if (v === '' || v === null || v === undefined) return null;
      const value = Number(v);
      if (!Number.isFinite(value)) {
        ctx.addIssue({ code: 'custom', message: `${label} harus berupa angka.` });
        return z.NEVER;
      }
      if (value < 0 || value > max) {
        ctx.addIssue({ code: 'custom', message: `${label} harus antara 0 dan ${max}.` });
        return z.NEVER;
      }
      return String(value / 100);
    });

export const cashAccountFormSchema = z.object({
  name: requiredText('Nama akun', 100),
  type: z.enum(['CASH', 'BANK']).default('BANK'),
  openingBalance: moneyField('Saldo awal').default('0'),
});

export type CashAccountFormInput = z.input<typeof cashAccountFormSchema>;

export const CASH_ACCOUNT_TYPE_LABELS = { CASH: 'Kas tunai', BANK: 'Rekening bank' } as const;

export const TERM_TYPE_LABELS = {
  DOWN_PAYMENT: 'Uang muka',
  PROGRESS: 'Termin progres',
  MILESTONE: 'Termin milestone',
  RETENTION: 'Pelepasan retensi',
} as const;

export const paymentTermFormSchema = z
  .object({
    seq: z.coerce.number().int().min(1, 'Urutan minimal 1.'),
    name: requiredText('Nama termin', 100),
    termType: z.enum(['DOWN_PAYMENT', 'PROGRESS', 'MILESTONE', 'RETENTION']).default('PROGRESS'),
    percentInput: percentInput('Persentase'),
    amount: z
      .union([moneyField('Nominal'), z.literal(''), z.null()])
      .default(null)
      .transform((v) => (v === '' || v === null || v === undefined ? null : String(v))),
    triggerInput: percentInput('Pemicu progres'),
    plannedDate: z
      .union([dayField('Tanggal rencana'), z.literal(''), z.null()])
      .default(null)
      .transform((v) => (v === '' || v === null || v === undefined ? null : v)),
    verificationDays: z.coerce.number().int().min(0).max(365).default(0),
    paymentLagDays: z.coerce.number().int().min(0).max(365).default(0),
    dpRecoupmentInput: percentInput('Potongan uang muka'),
    note: optionalText(500),
  })
  // The database enforces this too, but a message here names the field.
  .refine((v) => v.percentInput !== null || v.amount !== null, {
    message: 'Isi persentase atau nominal.',
    path: ['percentInput'],
  });

export type PaymentTermFormInput = z.input<typeof paymentTermFormSchema>;

export const PAYMENT_TERM_DEFAULTS = {
  seq: 1,
  name: '',
  termType: 'PROGRESS',
  percentInput: '',
  amount: '',
  triggerInput: '',
  plannedDate: '',
  verificationDays: 0,
  paymentLagDays: 0,
  dpRecoupmentInput: '',
  note: '',
} satisfies PaymentTermFormInput;

export const claimFormSchema = z.object({
  paymentTermId: requiredText('Termin'),
  claimNo: requiredText('Nomor tagihan', 50),
  claimDate: dayField('Tanggal tagihan'),
  certifiedInput: percentInput('Progres tersertifikasi').transform((v) => v ?? '0'),
});

export type ClaimFormInput = z.input<typeof claimFormSchema>;

const IN_CATEGORIES = ['DOWN_PAYMENT', 'TERMIN', 'RETENTION_RELEASE', 'OTHER_IN'] as const;
const OUT_CATEGORIES = [
  'MATERIAL',
  'LABOR',
  'EQUIPMENT',
  'SUBCON',
  'OPERATIONAL',
  'TAX',
  'OTHER_OUT',
] as const;

export const cashTransactionFormSchema = z
  .object({
    accountId: requiredText('Akun kas'),
    txnDate: dayField('Tanggal'),
    direction: z.enum(['IN', 'OUT']).default('OUT'),
    category: z.enum([...IN_CATEGORIES, ...OUT_CATEGORIES]),
    amount: moneyField('Nilai'),
    description: optionalText(300),
  })
  /*
   * Categories are directional in the database, and a mismatch there surfaces
   * as a constraint violation nobody can read. Caught here instead, next to the
   * field that caused it.
   */
  .refine(
    (v) =>
      v.direction === 'IN'
        ? (IN_CATEGORIES as readonly string[]).includes(v.category)
        : (OUT_CATEGORIES as readonly string[]).includes(v.category),
    { message: 'Kategori tidak sesuai arah transaksi.', path: ['category'] },
  );

export type CashTransactionFormInput = z.input<typeof cashTransactionFormSchema>;

export const payClaimFormSchema = z.object({
  accountId: requiredText('Akun kas'),
  paidAt: dayField('Tanggal bayar'),
});
