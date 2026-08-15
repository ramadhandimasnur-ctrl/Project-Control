import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { day, percent, primaryId } from './_shared';
import { dependencyTypeEnum, periodTypeEnum } from './enums';
import { auditColumns, users } from './org';
import { projects } from './projects';
import { workItems } from './work';

/**
 * The single source of periodisation for the whole project. Generated from
 * start_date..end_date plus period_type; everything time-bucketed (progress,
 * S-curve, cashflow, reports) joins through here.
 */
export const schedulePeriods = pgTable(
  'schedule_periods',
  {
    id: primaryId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    periodType: periodTypeEnum('period_type').notNull(),
    startDate: day('start_date').notNull(),
    endDate: day('end_date').notNull(),
    label: text('label').notNull(),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('schedule_periods_project_seq_unique').on(t.projectId, t.seq),
    index('schedule_periods_project_start_idx').on(t.projectId, t.startDate),
    check('schedule_periods_seq_positive', sql`${t.seq} >= 1`),
    check('schedule_periods_range_valid', sql`${t.endDate} >= ${t.startDate}`),
  ],
);

export const workItemSchedules = pgTable(
  'work_item_schedules',
  {
    id: primaryId(),
    workItemId: uuid('work_item_id')
      .notNull()
      .references(() => workItems.id, { onDelete: 'cascade' }),
    plannedStart: day('planned_start'),
    plannedFinish: day('planned_finish'),
    durationDays: integer('duration_days'),
    predecessorId: uuid('predecessor_id').references((): AnyPgColumn => workItems.id, {
      onDelete: 'set null',
    }),
    dependencyType: dependencyTypeEnum('dependency_type').notNull().default('FS'),
    lagDays: integer('lag_days').notNull().default(0),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('work_item_schedules_work_item_unique').on(t.workItemId),
    check(
      'work_item_schedules_range_valid',
      sql`${t.plannedStart} IS NULL OR ${t.plannedFinish} IS NULL OR ${t.plannedFinish} >= ${t.plannedStart}`,
    ),
    check(
      'work_item_schedules_duration_nonneg',
      sql`${t.durationDays} IS NULL OR ${t.durationDays} >= 0`,
    ),
    check('work_item_schedules_no_self_dependency', sql`${t.predecessorId} <> ${t.workItemId}`),
  ],
);

/**
 * Editable plan. `SUM(planned_pct)` per work item must equal 1 (±1e-6); the
 * service layer enforces it before a baseline can be taken.
 */
export const plannedDistributions = pgTable(
  'planned_distributions',
  {
    id: primaryId(),
    workItemId: uuid('work_item_id')
      .notNull()
      .references(() => workItems.id, { onDelete: 'cascade' }),
    periodId: uuid('period_id')
      .notNull()
      .references(() => schedulePeriods.id, { onDelete: 'restrict' }),
    plannedPct: percent('planned_pct').notNull().default('0'),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('planned_distributions_unique').on(t.workItemId, t.periodId),
    index('planned_distributions_period_idx').on(t.periodId),
    check(
      'planned_distributions_range',
      sql`${t.plannedPct} >= 0 AND ${t.plannedPct} <= 1`,
    ),
  ],
);

export const scheduleBaselines = pgTable(
  'schedule_baselines',
  {
    id: primaryId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    baselinedAt: timestamp('baselined_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    baselinedBy: uuid('baselined_by').references(() => users.id, { onDelete: 'set null' }),
    isActive: boolean('is_active').notNull().default(false),
    ...auditColumns(),
  },
  (t) => [
    index('schedule_baselines_project_idx').on(t.projectId),
    // At most one active baseline per project — the planned S-curve has to be
    // unambiguous.
    uniqueIndex('schedule_baselines_one_active')
      .on(t.projectId)
      .where(sql`${t.isActive}`),
  ],
);

/**
 * Frozen copy of the plan. The planned S-curve always reads from the active
 * baseline, never from `planned_distributions` (design decision 12).
 */
export const baselineDistributions = pgTable(
  'baseline_distributions',
  {
    id: primaryId(),
    baselineId: uuid('baseline_id')
      .notNull()
      .references(() => scheduleBaselines.id, { onDelete: 'cascade' }),
    workItemId: uuid('work_item_id')
      .notNull()
      .references(() => workItems.id, { onDelete: 'cascade' }),
    periodId: uuid('period_id')
      .notNull()
      .references(() => schedulePeriods.id, { onDelete: 'restrict' }),
    plannedPct: percent('planned_pct').notNull().default('0'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('baseline_distributions_unique').on(t.baselineId, t.workItemId, t.periodId),
    index('baseline_distributions_baseline_idx').on(t.baselineId),
    check('baseline_distributions_range', sql`${t.plannedPct} >= 0 AND ${t.plannedPct} <= 1`),
  ],
);
