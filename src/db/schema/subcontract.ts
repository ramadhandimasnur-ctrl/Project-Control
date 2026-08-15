import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { day, money, percent, primaryId, quantity } from './_shared';
import { certificateStatusEnum, subcontractStatusEnum, subcontractTypeEnum } from './enums';
import { auditColumns } from './org';
import { projects } from './projects';
import { units } from './resources';
import { schedulePeriods } from './schedule';
import { workItems } from './work';

/**
 * Subcontracting and piecework ("borongan") are first-class here: in the source
 * Excel system this is the second-largest cash stream after material.
 */
export const subcontracts = pgTable(
  'subcontracts',
  {
    id: primaryId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    partyName: text('party_name').notNull(),
    scope: text('scope'),
    contractType: subcontractTypeEnum('contract_type').notNull().default('LUMPSUM'),
    contractValue: money('contract_value').notNull().default('0'),
    retentionPercent: percent('retention_percent').notNull().default('0'),
    startDate: day('start_date'),
    endDate: day('end_date'),
    status: subcontractStatusEnum('status').notNull().default('DRAFT'),
    note: text('note'),
    ...auditColumns(),
  },
  (t) => [
    index('subcontracts_project_idx').on(t.projectId),
    check('subcontracts_value_nonneg', sql`${t.contractValue} >= 0`),
    check(
      'subcontracts_retention_range',
      sql`${t.retentionPercent} >= 0 AND ${t.retentionPercent} <= 1`,
    ),
    check(
      'subcontracts_period_valid',
      sql`${t.startDate} IS NULL OR ${t.endDate} IS NULL OR ${t.endDate} >= ${t.startDate}`,
    ),
  ],
);

export const subcontractItems = pgTable(
  'subcontract_items',
  {
    id: primaryId(),
    subcontractId: uuid('subcontract_id')
      .notNull()
      .references(() => subcontracts.id, { onDelete: 'cascade' }),
    workItemId: uuid('work_item_id').references(() => workItems.id, { onDelete: 'set null' }),
    description: text('description').notNull(),
    qty: quantity('qty').notNull().default('0'),
    unitId: uuid('unit_id').references(() => units.id, { onDelete: 'restrict' }),
    unitRate: money('unit_rate').notNull().default('0'),
    amount: money('amount').notNull().default('0'),
    ...auditColumns(),
  },
  (t) => [
    index('subcontract_items_subcontract_idx').on(t.subcontractId),
    check(
      'subcontract_items_nonneg',
      sql`${t.qty} >= 0 AND ${t.unitRate} >= 0 AND ${t.amount} >= 0`,
    ),
  ],
);

/** Advances paid ahead of certified work — "kasbon mandor". */
export const subcontractAdvances = pgTable(
  'subcontract_advances',
  {
    id: primaryId(),
    subcontractId: uuid('subcontract_id')
      .notNull()
      .references(() => subcontracts.id, { onDelete: 'cascade' }),
    advanceDate: day('advance_date').notNull(),
    amount: money('amount').notNull(),
    note: text('note'),
    ...auditColumns(),
  },
  (t) => [
    index('subcontract_advances_subcontract_idx').on(t.subcontractId, t.advanceDate),
    check('subcontract_advances_amount_positive', sql`${t.amount} > 0`),
  ],
);

export const subcontractCertificates = pgTable(
  'subcontract_certificates',
  {
    id: primaryId(),
    subcontractId: uuid('subcontract_id')
      .notNull()
      .references(() => subcontracts.id, { onDelete: 'cascade' }),
    periodId: uuid('period_id')
      .notNull()
      .references(() => schedulePeriods.id, { onDelete: 'restrict' }),
    certNo: text('cert_no').notNull(),
    certDate: day('cert_date').notNull(),

    progressValue: money('progress_value').notNull().default('0'),
    advanceRecouped: money('advance_recouped').notNull().default('0'),
    retentionWithheld: money('retention_withheld').notNull().default('0'),
    netPayable: money('net_payable').notNull().default('0'),

    status: certificateStatusEnum('status').notNull().default('DRAFT'),
    paidAt: day('paid_at'),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('subcontract_certificates_no_unique').on(t.subcontractId, t.certNo),
    index('subcontract_certificates_period_idx').on(t.periodId),
    check(
      'subcontract_certificates_nonneg',
      sql`${t.progressValue} >= 0 AND ${t.advanceRecouped} >= 0 AND ${t.retentionWithheld} >= 0`,
    ),
  ],
);
