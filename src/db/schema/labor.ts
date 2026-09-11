import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { day, money, primaryId, quantity } from './_shared';
import { auditColumns, organizations } from './org';
import { projects } from './projects';
import { schedulePeriods } from './schedule';
import { workItems } from './work';

/**
 * Mandor, as a record rather than a name typed on each contract.
 *
 * The same person takes piecework one month and supplies a day-rate crew the
 * next. Held as free text on every document, the bank account has to be looked
 * up each time and a misspelling makes two people out of one.
 */
export const foremen = pgTable(
  'foremen',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    phone: text('phone'),
    address: text('address'),
    /** Where the payment goes. The reason this table exists at all. */
    bankAccount: text('bank_account'),
    isActive: boolean('is_active').notNull().default(true),
    note: text('note'),
    ...auditColumns(),
  },
  (t) => [uniqueIndex('foremen_org_code_unique').on(t.orgId, t.code)],
);

/**
 * A day of day-rate labour.
 *
 * Distinct from a piecework contract in the one way that matters: the risk
 * sits with whoever is paying. A foreman on piecework who works slowly earns
 * the same; a day-rate crew that works slowly costs more. So there is no
 * contract quantity to measure against and no certificate to raise — just a
 * day, a headcount, and a rate.
 *
 * `personDays` and `grossAmount` are stored rather than derived on read,
 * because the rate can be renegotiated and a day already paid must keep saying
 * what it cost.
 */
export const dailyLabor = pgTable(
  'daily_labor',
  {
    id: primaryId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    periodId: uuid('period_id').references(() => schedulePeriods.id, { onDelete: 'set null' }),
    foremanId: uuid('foreman_id').references(() => foremen.id, { onDelete: 'set null' }),
    workDate: day('work_date').notNull(),
    workerCount: integer('worker_count').notNull(),
    /*
     * Half days are ordinary on site — rain stops work at noon, or a crew
     * arrives late. 0,5625 is four and a half hours of eight, which is the
     * kind of figure that appears in a real attendance book.
     */
    dayFraction: quantity('day_fraction').notNull().default('1'),
    dailyRate: money('daily_rate').notNull(),
    personDays: quantity('person_days').notNull(),
    grossAmount: money('gross_amount').notNull(),
    status: text('status').notNull().default('DRAFT'),
    paidAt: day('paid_at'),
    paymentMethod: text('payment_method'),
    refNo: text('ref_no'),
    note: text('note'),
    ...auditColumns(),
  },
  (t) => [
    index('daily_labor_project_idx').on(t.projectId, t.workDate),
    index('daily_labor_foreman_idx').on(t.foremanId),
    check(
      'daily_labor_positive',
      sql`${t.workerCount} > 0 AND ${t.dayFraction} > 0 AND ${t.dailyRate} >= 0`,
    ),
    check('daily_labor_status_known', sql`${t.status} IN ('DRAFT', 'APPROVED', 'PAID')`),
  ],
);

/**
 * Which work items the day was spent on, in person-days.
 *
 * Without this a day's labour is a project-level lump, and cost control cannot
 * say which item bore it — which is the whole reason cost control exists. The
 * allocation is by person-days rather than by money because that is what a
 * foreman can actually report at the end of a day.
 */
export const dailyLaborLines = pgTable(
  'daily_labor_lines',
  {
    id: primaryId(),
    dailyLaborId: uuid('daily_labor_id')
      .notNull()
      .references(() => dailyLabor.id, { onDelete: 'cascade' }),
    workItemId: uuid('work_item_id').references(() => workItems.id, { onDelete: 'set null' }),
    personDays: quantity('person_days').notNull(),
    /** What came out of those person-days, when anybody measured it. */
    qtyOutput: quantity('qty_output'),
    allocatedCost: money('allocated_cost').notNull().default('0'),
    note: text('note'),
    ...auditColumns(),
  },
  (t) => [
    index('daily_labor_lines_parent_idx').on(t.dailyLaborId),
    check(
      'daily_labor_lines_positive',
      sql`${t.personDays} > 0 AND ${t.allocatedCost} >= 0`,
    ),
  ],
);
