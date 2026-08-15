import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { day, money, percent, primaryId } from './_shared';
import {
  cashAccountTypeEnum,
  cashCategoryEnum,
  cashDirectionEnum,
  cashSourceTypeEnum,
  claimStatusEnum,
  paymentTermStatusEnum,
  termTypeEnum,
} from './enums';
import { auditColumns } from './org';
import { projects } from './projects';
import { schedulePeriods } from './schedule';

export const cashAccounts = pgTable(
  'cash_accounts',
  {
    id: primaryId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: cashAccountTypeEnum('type').notNull().default('BANK'),
    openingBalance: money('opening_balance').notNull().default('0'),
    ...auditColumns(),
  },
  (t) => [uniqueIndex('cash_accounts_project_name_unique').on(t.projectId, t.name)],
);

/**
 * Payment terms are fully free-form: 30/20/20/30, 20/30/25/25, or milestone
 * driven. Down payments are supported as a term type with staged recoupment.
 */
export const paymentTerms = pgTable(
  'payment_terms',
  {
    id: primaryId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    name: text('name').notNull(),
    termType: termTypeEnum('term_type').notNull().default('PROGRESS'),

    /** Either a percentage of contract value or an explicit amount. */
    percent: percent('percent'),
    amount: money('amount'),

    /** Progress fraction that unlocks this term, e.g. 0.30. */
    triggerProgressPct: percent('trigger_progress_pct'),
    plannedDate: day('planned_date'),

    verificationDays: integer('verification_days').notNull().default(0),
    paymentLagDays: integer('payment_lag_days').notNull().default(0),
    dpRecoupmentPercent: percent('dp_recoupment_percent').notNull().default('0'),

    status: paymentTermStatusEnum('status').notNull().default('PLANNED'),
    note: text('note'),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('payment_terms_project_seq_unique').on(t.projectId, t.seq),
    check('payment_terms_seq_positive', sql`${t.seq} >= 1`),
    check(
      'payment_terms_has_value',
      sql`${t.percent} IS NOT NULL OR ${t.amount} IS NOT NULL`,
    ),
    check(
      'payment_terms_ranges',
      sql`(${t.percent} IS NULL OR (${t.percent} >= 0 AND ${t.percent} <= 1))
          AND (${t.amount} IS NULL OR ${t.amount} >= 0)
          AND (${t.triggerProgressPct} IS NULL OR (${t.triggerProgressPct} >= 0 AND ${t.triggerProgressPct} <= 1))
          AND ${t.dpRecoupmentPercent} >= 0 AND ${t.dpRecoupmentPercent} <= 1`,
    ),
    check(
      'payment_terms_lag_nonneg',
      sql`${t.verificationDays} >= 0 AND ${t.paymentLagDays} >= 0`,
    ),
  ],
);

export const paymentClaims = pgTable(
  'payment_claims',
  {
    id: primaryId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    paymentTermId: uuid('payment_term_id')
      .notNull()
      .references(() => paymentTerms.id, { onDelete: 'restrict' }),
    periodId: uuid('period_id').references(() => schedulePeriods.id, { onDelete: 'restrict' }),

    claimNo: text('claim_no').notNull(),
    claimDate: day('claim_date').notNull(),
    certifiedProgressPct: percent('certified_progress_pct').notNull().default('0'),

    grossAmount: money('gross_amount').notNull().default('0'),
    dpRecoupment: money('dp_recoupment').notNull().default('0'),
    retentionWithheld: money('retention_withheld').notNull().default('0'),
    vatAmount: money('vat_amount').notNull().default('0'),
    whtAmount: money('wht_amount').notNull().default('0'),
    netAmount: money('net_amount').notNull().default('0'),

    status: claimStatusEnum('status').notNull().default('DRAFT'),
    paidAt: day('paid_at'),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('payment_claims_project_no_unique').on(t.projectId, t.claimNo),
    index('payment_claims_term_idx').on(t.paymentTermId),
    check(
      'payment_claims_progress_range',
      sql`${t.certifiedProgressPct} >= 0 AND ${t.certifiedProgressPct} <= 1`,
    ),
    check(
      'payment_claims_amounts_nonneg',
      sql`${t.grossAmount} >= 0 AND ${t.dpRecoupment} >= 0 AND ${t.retentionWithheld} >= 0
          AND ${t.vatAmount} >= 0 AND ${t.whtAmount} >= 0`,
    ),
  ],
);

/**
 * Cash ledger. Rows whose `source_type` is not MANUAL are written by the
 * posting routines (purchase, subcontract certificate, payment claim) inside
 * the same database transaction as their source document, and must never be
 * edited directly — corrections go through a void plus a new row.
 */
export const cashTransactions = pgTable(
  'cash_transactions',
  {
    id: primaryId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => cashAccounts.id, { onDelete: 'restrict' }),
    txnDate: day('txn_date').notNull(),
    direction: cashDirectionEnum('direction').notNull(),
    category: cashCategoryEnum('category').notNull(),
    amount: money('amount').notNull(),

    sourceType: cashSourceTypeEnum('source_type').notNull().default('MANUAL'),
    sourceId: uuid('source_id'),

    description: text('description'),
    isVoid: boolean('is_void').notNull().default(false),
    voidReason: text('void_reason'),
    ...auditColumns(),
  },
  (t) => [
    index('cash_transactions_running_idx').on(t.projectId, t.accountId, t.txnDate, t.createdAt),
    index('cash_transactions_source_idx').on(t.sourceType, t.sourceId),
    check('cash_transactions_amount_positive', sql`${t.amount} > 0`),
    check(
      'cash_transactions_void_has_reason',
      sql`${t.isVoid} = false OR ${t.voidReason} IS NOT NULL`,
    ),
    // Categories are directional; mixing them would corrupt every cashflow view.
    check(
      'cash_transactions_category_matches_direction',
      sql`(${t.direction} = 'IN'  AND ${t.category} IN ('DOWN_PAYMENT','TERMIN','RETENTION_RELEASE','OTHER_IN'))
       OR (${t.direction} = 'OUT' AND ${t.category} IN ('MATERIAL','LABOR','EQUIPMENT','SUBCON','OPERATIONAL','TAX','OTHER_OUT'))`,
    ),
  ],
);
