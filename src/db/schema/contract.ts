import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { day, money, percent, primaryId, quantity } from './_shared';
import { contractRevisionStatusEnum } from './enums';
import { auditColumns, users } from './org';
import { projects } from './projects';
import { workItems } from './work';

/**
 * Contract change orders — pekerjaan tambah/kurang.
 *
 * A project's scope moves: volumes are corrected against what the site turns
 * out to be, items are added, items are dropped. Editing the work breakdown
 * directly would answer "how much is this job worth now" while destroying the
 * answer to "what did we agree to build", and the second question is the one
 * an addendum has to be able to prove.
 */

/**
 * The original scope, frozen — Baseline 0.
 *
 * One per project, taken before the first revision is approved. It is a copy
 * rather than a view because the whole point is that it stops moving: names,
 * volumes and values as they stood when the contract was signed, so a revision
 * can be measured against something that will not quietly follow it.
 */
export const contractBaselines = pgTable(
  'contract_baselines',
  {
    id: primaryId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** The project's declared contract value at the moment of freezing. */
    contractValue: money('contract_value').notNull().default('0'),
    frozenAt: timestamp('frozen_at', { withTimezone: true }).notNull().defaultNow(),
    frozenBy: uuid('frozen_by').references(() => users.id, { onDelete: 'set null' }),
    notes: text('notes'),
    ...auditColumns(),
  },
  (t) => [uniqueIndex('contract_baselines_project_unique').on(t.projectId)],
);

/**
 * One work item as it stood at the freeze.
 *
 * Code and name are copied alongside the id: an item renamed after the freeze
 * still has to print under the name the contract used, and an item deleted
 * outright still has to appear in the comparison rather than vanishing from
 * the history of its own removal.
 */
export const contractBaselineItems = pgTable(
  'contract_baseline_items',
  {
    id: primaryId(),
    baselineId: uuid('baseline_id')
      .notNull()
      .references(() => contractBaselines.id, { onDelete: 'cascade' }),
    workItemId: uuid('work_item_id').references(() => workItems.id, { onDelete: 'set null' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    unitCode: text('unit_code').notNull(),
    volume: quantity('volume').notNull().default('0'),
    unitValue: money('unit_value').notNull().default('0'),
    totalValue: money('total_value').notNull().default('0'),
    weight: percent('weight').notNull().default('0'),
    sortOrder: integer('sort_order').notNull().default(0),
    ...auditColumns(),
  },
  (t) => [index('contract_baseline_items_baseline_idx').on(t.baselineId)],
);

export const contractRevisions = pgTable(
  'contract_revisions',
  {
    id: primaryId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** 1, 2, 3 … rendered as CCO-01, CCO-02. Unique per project. */
    seq: integer('seq').notNull(),
    title: text('title').notNull(),
    reason: text('reason'),
    effectiveDate: day('effective_date').notNull(),
    status: contractRevisionStatusEnum('status').notNull().default('DRAFT'),

    /*
     * The declared contract value on either side of the approval, recorded at
     * the moment it happens. Recomputing them later would report today's
     * figures rather than the ones the addendum was signed on.
     */
    contractValueBefore: money('contract_value_before'),
    contractValueAfter: money('contract_value_after'),

    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('contract_revisions_project_seq_unique').on(t.projectId, t.seq),
    index('contract_revisions_project_idx').on(t.projectId),
    check('contract_revisions_seq_positive', sql`${t.seq} >= 1`),
  ],
);

/**
 * One work item's volume change within a revision.
 *
 * Adding, changing and removing are all the same operation on a volume: a line
 * that starts from zero adds work, one that ends at zero removes it. Three
 * separate mechanisms would need three sets of arithmetic that must agree.
 *
 * `volumeBefore` is stored rather than read live, because a revision approved
 * in March has to keep saying what the volume was in March.
 */
export const contractRevisionLines = pgTable(
  'contract_revision_lines',
  {
    id: primaryId(),
    revisionId: uuid('revision_id')
      .notNull()
      .references(() => contractRevisions.id, { onDelete: 'cascade' }),
    workItemId: uuid('work_item_id')
      .notNull()
      .references(() => workItems.id, { onDelete: 'cascade' }),
    volumeBefore: quantity('volume_before').notNull().default('0'),
    volumeAfter: quantity('volume_after').notNull().default('0'),
    note: text('note'),
    sortOrder: integer('sort_order').notNull().default(0),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('contract_revision_lines_unique').on(t.revisionId, t.workItemId),
    index('contract_revision_lines_revision_idx').on(t.revisionId),
    check(
      'contract_revision_lines_nonneg',
      sql`${t.volumeBefore} >= 0 AND ${t.volumeAfter} >= 0`,
    ),
  ],
);
