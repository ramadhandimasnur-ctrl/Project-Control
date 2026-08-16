import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { primaryId } from './_shared';
import {
  auditActionEnum,
  issueSeverityEnum,
  issueStatusEnum,
  reportTypeEnum,
  signatorySlotEnum,
} from './enums';
import { auditColumns, organizations, users } from './org';
import { projects } from './projects';
import { schedulePeriods } from './schedule';

/**
 * Who signs a printed report, and as what.
 *
 * One row per slot per project, so the three columns at the foot of every sheet
 * are filled from the same place rather than retyped per report. The signature
 * image is optional by design: a site that signs on paper wants a clean empty
 * box above the printed name, not a placeholder telling them something is
 * missing.
 *
 * `slot` is the column's meaning, not a person — "Diperiksa oleh" stays the
 * middle column even when the person filling it changes.
 */
export const projectSignatories = pgTable(
  'project_signatories',
  {
    id: primaryId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    slot: signatorySlotEnum('slot').notNull(),
    name: text('name').notNull(),
    position: text('position').notNull(),
    /** Path into the private document bucket; null means sign by hand. */
    signaturePath: text('signature_path'),
    ...auditColumns(),
  },
  (t) => [uniqueIndex('project_signatories_slot_unique').on(t.projectId, t.slot)],
);

/**
 * Published reports are frozen. `payload` holds the fully computed figures, so
 * reopening an old report shows what was published, not a recomputation
 * against today's data. One of only two intentional stores of derived values.
 */
export const reportSnapshots = pgTable(
  'report_snapshots',
  {
    id: primaryId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    periodId: uuid('period_id')
      .notNull()
      .references(() => schedulePeriods.id, { onDelete: 'restrict' }),
    reportType: reportTypeEnum('report_type').notNull(),
    payload: jsonb('payload').notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    generatedBy: uuid('generated_by').references(() => users.id, { onDelete: 'set null' }),
    pdfPath: text('pdf_path'),
  },
  (t) => [
    uniqueIndex('report_snapshots_unique').on(t.projectId, t.periodId, t.reportType, t.generatedAt),
    index('report_snapshots_project_idx').on(t.projectId, t.reportType),
  ],
);

export const issues = pgTable(
  'issues',
  {
    id: primaryId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    periodId: uuid('period_id').references(() => schedulePeriods.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    description: text('description'),
    severity: issueSeverityEnum('severity').notNull().default('MEDIUM'),
    status: issueStatusEnum('status').notNull().default('OPEN'),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    ...auditColumns(),
  },
  (t) => [index('issues_project_status_idx').on(t.projectId, t.status)],
);

/** Charter rule 9: every mutation writes here. */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: primaryId(),
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'set null' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    tableName: text('table_name').notNull(),
    recordId: uuid('record_id'),
    action: auditActionEnum('action').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('audit_logs_project_idx').on(t.projectId, t.occurredAt),
    index('audit_logs_record_idx').on(t.tableName, t.recordId),
  ],
);
