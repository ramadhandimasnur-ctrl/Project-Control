import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { coefficient, day, money, percent, primaryId, quantity } from './_shared';
import { ahspRoleEnum, progressMethodEnum } from './enums';
import { auditColumns } from './org';
import { projects } from './projects';
import { resources, units } from './resources';

export const workGroups = pgTable(
  'work_groups',
  {
    id: primaryId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id').references((): AnyPgColumn => workGroups.id, {
      onDelete: 'restrict',
    }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('work_groups_project_code_unique').on(t.projectId, t.code),
    index('work_groups_project_idx').on(t.projectId),
  ],
);

export const workItems = pgTable(
  'work_items',
  {
    id: primaryId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id').references(() => workGroups.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    spec: text('spec'),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'restrict' }),
    volume: quantity('volume').notNull().default('0'),

    /**
     * The authority on revenue (design decision 1). RAB derived from the
     * resource breakdown is an internal estimate used to check margin, not the
     * contract figure.
     */
    contractUnitPrice: money('contract_unit_price'),

    progressMethod: progressMethodEnum('progress_method').notNull().default('VOLUME'),
    /** False for operational/overhead lines: costed, but not part of progress. */
    includeInProgressWeight: boolean('include_in_progress_weight').notNull().default(true),

    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('work_items_project_code_unique').on(t.projectId, t.code),
    index('work_items_project_idx').on(t.projectId),
    index('work_items_group_idx').on(t.groupId),
    check('work_items_volume_nonneg', sql`${t.volume} >= 0`),
    check(
      'work_items_contract_unit_price_nonneg',
      sql`${t.contractUnitPrice} IS NULL OR ${t.contractUnitPrice} >= 0`,
    ),
  ],
);

/**
 * Traceable volume build-up, mirroring the VOLUME sheet of the source workbook.
 * When take-off rows exist, `work_items.volume` is their sum; otherwise the
 * volume is entered directly.
 */
export const volumeTakeoffs = pgTable(
  'volume_takeoffs',
  {
    id: primaryId(),
    workItemId: uuid('work_item_id')
      .notNull()
      .references(() => workItems.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    /** Human-readable derivation, e.g. "3 × 4.5 × 0.15" — kept for audit. */
    expression: text('expression'),
    qty: quantity('qty').notNull().default('0'),
    note: text('note'),
    sortOrder: integer('sort_order').notNull().default(0),
    ...auditColumns(),
  },
  (t) => [index('volume_takeoffs_work_item_idx').on(t.workItemId)],
);

export const workItemResources = pgTable(
  'work_item_resources',
  {
    id: primaryId(),
    workItemId: uuid('work_item_id')
      .notNull()
      .references(() => workItems.id, { onDelete: 'cascade' }),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'restrict' }),
    role: ahspRoleEnum('role').notNull(),
    coefRab: coefficient('coef_rab').notNull().default('0'),
    coefRap: coefficient('coef_rap').notNull().default('0'),
    wasteFactor: percent('waste_factor').notNull().default('0'),
    note: text('note'),
    sortOrder: integer('sort_order').notNull().default(0),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('work_item_resources_unique').on(t.workItemId, t.resourceId, t.role),
    index('work_item_resources_work_item_idx').on(t.workItemId),
    index('work_item_resources_resource_idx').on(t.resourceId),
    check(
      'work_item_resources_nonneg',
      sql`${t.coefRab} >= 0 AND ${t.coefRap} >= 0 AND ${t.wasteFactor} >= 0`,
    ),
  ],
);

/** Only meaningful when progress_method = MILESTONE; weights must sum to 1. */
export const workItemMilestones = pgTable(
  'work_item_milestones',
  {
    id: primaryId(),
    workItemId: uuid('work_item_id')
      .notNull()
      .references(() => workItems.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    weight: percent('weight').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    /**
     * When the stage was finished, or null while it is outstanding.
     *
     * A milestone is completed once for the whole project rather than per
     * period: "pondasi selesai" does not happen again in March. The period a
     * completion lands in is derived from this date.
     */
    completedAt: day('completed_at'),
    ...auditColumns(),
  },
  (t) => [
    index('work_item_milestones_work_item_idx').on(t.workItemId),
    check('work_item_milestones_weight_range', sql`${t.weight} >= 0 AND ${t.weight} <= 1`),
  ],
);
