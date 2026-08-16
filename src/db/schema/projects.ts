import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { day, money, percent, primaryId } from './_shared';
import {
  costRecognitionEnum,
  durationUnitEnum,
  periodTypeEnum,
  projectRoleEnum,
  projectStatusEnum,
  weightBasisEnum,
} from './enums';
import { auditColumns, organizations, users } from './org';

export const projects = pgTable(
  'projects',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    name: text('name').notNull(),

    contractNo: text('contract_no'),
    ownerName: text('owner_name'),
    contractorName: text('contractor_name'),
    location: text('location'),
    projectType: text('project_type'),

    contractValue: money('contract_value').notNull().default('0'),

    startDate: day('start_date').notNull(),
    endDate: day('end_date').notNull(),
    duration: integer('duration'),
    durationUnit: durationUnitEnum('duration_unit').notNull().default('DAY'),
    periodType: periodTypeEnum('period_type').notNull().default('WEEK'),

    /*
     * Whether Saturdays and Sundays are worked.
     *
     * Defaults to true so existing projects keep the durations they were
     * planned with; switching it off is a deliberate act that reinterprets the
     * schedule, not something a migration should do on anyone's behalf.
     */
    countWeekends: boolean('count_weekends').notNull().default(true),

    // Tax and retention rates are project configuration — never hardcoded.
    retentionPercent: percent('retention_percent').notNull().default('0'),
    retentionReleaseDays: integer('retention_release_days').notNull().default(0),
    vatPercent: percent('vat_percent').notNull().default('0'),
    whtPercent: percent('wht_percent').notNull().default('0'),

    progressWeightBasis: weightBasisEnum('progress_weight_basis').notNull().default('CONTRACT'),
    costRecognition: costRecognitionEnum('cost_recognition').notNull().default('PURCHASE_BASED'),
    defaultMarkup: percent('default_markup').notNull().default('0'),

    // Deviation thresholds: negative fractions, e.g. -0.005 = 0.5% behind plan.
    thresholdWarning: percent('threshold_warning').notNull().default('-0.005'),
    thresholdDelayed: percent('threshold_delayed').notNull().default('-0.05'),

    // Behavioural switches referenced by charter sections 4.5 and 7.
    requireChecklistBeforeApprove: boolean('require_checklist_before_approve')
      .notNull()
      .default(true),
    allowNegativeStock: boolean('allow_negative_stock').notNull().default(false),

    status: projectStatusEnum('status').notNull().default('DRAFT'),
    notes: text('notes'),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('projects_org_code_unique').on(t.orgId, t.code),
    index('projects_org_idx').on(t.orgId),
    check('projects_period_valid', sql`${t.endDate} >= ${t.startDate}`),
    check('projects_contract_value_nonneg', sql`${t.contractValue} >= 0`),
    check(
      'projects_rates_nonneg',
      sql`${t.retentionPercent} >= 0 AND ${t.vatPercent} >= 0 AND ${t.whtPercent} >= 0 AND ${t.defaultMarkup} >= 0`,
    ),
    check(
      'projects_lag_days_nonneg',
      sql`${t.retentionReleaseDays} >= 0`,
    ),
    // WARNING must not be stricter than DELAYED, otherwise status() is unreachable.
    check('projects_threshold_order', sql`${t.thresholdWarning} >= ${t.thresholdDelayed}`),
  ],
);

export const projectMembers = pgTable(
  'project_members',
  {
    id: primaryId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: projectRoleEnum('role').notNull(),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('project_members_project_user_unique').on(t.projectId, t.userId),
    index('project_members_user_idx').on(t.userId),
  ],
);
