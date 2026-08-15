import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { day, percent, primaryId, quantity } from './_shared';
import { checklistResultEnum, progressMethodEnum, progressStatusEnum } from './enums';
import { auditColumns, users } from './org';
import { projects } from './projects';
import { schedulePeriods } from './schedule';
import { workItems } from './work';

/**
 * One row per work item per period.
 *
 * Both the quantity and the percentage are stored: whichever the user typed is
 * authoritative and the other is derived by `progress.ts` according to
 * `method`. Keeping both means a later change to `work_items.volume` cannot
 * silently rewrite history.
 */
export const progressEntries = pgTable(
  'progress_entries',
  {
    id: primaryId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    workItemId: uuid('work_item_id')
      .notNull()
      .references(() => workItems.id, { onDelete: 'cascade' }),
    periodId: uuid('period_id')
      .notNull()
      .references(() => schedulePeriods.id, { onDelete: 'restrict' }),
    entryDate: day('entry_date').notNull(),

    qtyThisPeriod: quantity('qty_this_period').notNull().default('0'),
    pctThisPeriod: percent('pct_this_period').notNull().default('0'),
    method: progressMethodEnum('method').notNull(),

    status: progressStatusEnum('status').notNull().default('DRAFT'),
    submittedBy: uuid('submitted_by').references(() => users.id, { onDelete: 'set null' }),
    submittedAt: timestamp('submitted_at', { withTimezone: true, mode: 'date' }),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
    approvedAt: timestamp('approved_at', { withTimezone: true, mode: 'date' }),
    rejectReason: text('reject_reason'),
    note: text('note'),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('progress_entries_item_period_unique').on(t.workItemId, t.periodId),
    index('progress_entries_project_period_idx').on(t.projectId, t.periodId),
    index('progress_entries_status_idx').on(t.projectId, t.status),
    check('progress_entries_qty_nonneg', sql`${t.qtyThisPeriod} >= 0`),
    // The cumulative <= 100% rule needs cross-row context, so it lives in the
    // service layer; per-row sanity is enforced here.
    check('progress_entries_pct_range', sql`${t.pctThisPeriod} >= 0 AND ${t.pctThisPeriod} <= 1`),
  ],
);

export const progressDocuments = pgTable(
  'progress_documents',
  {
    id: primaryId(),
    progressEntryId: uuid('progress_entry_id')
      .notNull()
      .references(() => progressEntries.id, { onDelete: 'cascade' }),
    storagePath: text('storage_path').notNull(),
    caption: text('caption'),
    takenAt: timestamp('taken_at', { withTimezone: true, mode: 'date' }),
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('progress_documents_entry_idx').on(t.progressEntryId)],
);

/**
 * Quality gate. When `projects.require_checklist_before_approve` is on,
 * approving progress is refused until `verdict` is PASS.
 */
export const workItemChecklists = pgTable(
  'work_item_checklists',
  {
    id: primaryId(),
    workItemId: uuid('work_item_id')
      .notNull()
      .references(() => workItems.id, { onDelete: 'cascade' }),
    periodId: uuid('period_id').references(() => schedulePeriods.id, { onDelete: 'restrict' }),

    asDrawing: checklistResultEnum('as_drawing').notNull().default('NA'),
    position: checklistResultEnum('position').notNull().default('NA'),
    dimension: checklistResultEnum('dimension').notNull().default('NA'),

    /** Derived in the database so no caller can disagree about the verdict. */
    verdict: checklistResultEnum('verdict').generatedAlwaysAs(
      sql`CASE
            WHEN as_drawing = 'FAIL' OR position = 'FAIL' OR dimension = 'FAIL' THEN 'FAIL'
            WHEN as_drawing = 'PASS' AND position = 'PASS' AND dimension = 'PASS' THEN 'PASS'
            ELSE 'NA'
          END::checklist_result`,
    ),

    checkedAt: day('checked_at'),
    checkedBy: uuid('checked_by').references(() => users.id, { onDelete: 'set null' }),
    note: text('note'),
    photoPath: text('photo_path'),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('work_item_checklists_item_period_unique')
      .on(t.workItemId, t.periodId)
      .where(sql`${t.periodId} IS NOT NULL`),
    index('work_item_checklists_work_item_idx').on(t.workItemId),
  ],
);
