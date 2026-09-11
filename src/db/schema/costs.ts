import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { day, money, primaryId, quantity } from './_shared';
import { ahspRoleEnum } from './enums';
import { auditColumns } from './org';
import { projects } from './projects';
import { resources } from './resources';
import { dailyLabor } from './labor';
import { subcontractCertificates } from './subcontract';
import { workItems } from './work';

/**
 * Money spent, booked against the work item that consumed it.
 *
 * The project already knows what it has spent in total — that falls out of the
 * cash ledger. What it could not say is *which work item* the money went to,
 * and that is the difference between "we are over budget" and "we are over
 * budget on the roof". Only the second one can be acted on.
 *
 * Material is deliberately absent from this table. Issuing material from the
 * warehouse to a work item already records quantity, unit cost and the item it
 * went to, so re-entering it here would create a second version of the same
 * fact — and the two would eventually disagree. The view
 * `v_work_item_actual_cost` unions the two sources and labels each, which is
 * what makes the total explainable line by line.
 *
 * So this table is for costs that have no document of their own: a day's
 * labour, plant hire, a subcontractor's invoice against one item.
 */
export const actualCosts = pgTable(
  'actual_costs',
  {
    id: primaryId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /*
     * Nullable: a site overhead belongs to the project and to no single item.
     * Forcing a choice would make somebody pick an item at random, and a wrong
     * attribution is worse than an honest blank.
     */
    workItemId: uuid('work_item_id').references(() => workItems.id, { onDelete: 'set null' }),
    /** Optional, and only ever a label — the amount is what is booked. */
    resourceId: uuid('resource_id').references(() => resources.id, { onDelete: 'set null' }),
    category: ahspRoleEnum('category').notNull(),
    costDate: day('cost_date').notNull(),
    qty: quantity('qty'),
    unitCost: money('unit_cost'),
    amount: money('amount').notNull(),
    /*
     * The certificate that produced this cost, when one did.
     *
     * Approving a certificate books its value here; approving it again replaces
     * that booking rather than adding a second copy. Without the link the only
     * way to tell one from the other would be matching on amount and date.
     */
    subcontractCertificateId: uuid('subcontract_certificate_id').references(
      () => subcontractCertificates.id,
      { onDelete: 'cascade' },
    ),
    /*
     * The day of labour that produced this cost, when one did.
     *
     * Same reason as the certificate link beside it: approving a day again
     * replaces its booking rather than adding a second copy, and the only
     * other way to tell two identical bookings apart would be by amount and
     * date — which on a site that pays the same crew the same rate every day
     * is no way at all.
     */
    dailyLaborId: uuid('daily_labor_id').references(() => dailyLabor.id, {
      onDelete: 'cascade',
    }),
    /** Where this came from: an invoice number, a certificate, a payroll run. */
    sourceRef: text('source_ref'),
    note: text('note'),
    ...auditColumns(),
  },
  (t) => [
    index('actual_costs_project_idx').on(t.projectId, t.costDate),
    index('actual_costs_work_item_idx').on(t.workItemId),
    check('actual_costs_amount_nonneg', sql`${t.amount} >= 0`),
  ],
);
