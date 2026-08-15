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

import { coefficient, day, money, primaryId } from './_shared';
import { priceTypeEnum, resourceTypeEnum, unitDimensionEnum } from './enums';
import { auditColumns, organizations } from './org';
import { projects } from './projects';

export const units = pgTable(
  'units',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    dimension: unitDimensionEnum('dimension').notNull(),
    /** Points at the canonical unit of the same dimension (m, m2, kg, …). */
    baseUnitId: uuid('base_unit_id').references((): AnyPgColumn => units.id, {
      onDelete: 'restrict',
    }),
    factorToBase: coefficient('factor_to_base').notNull().default('1'),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('units_org_code_unique').on(t.orgId, t.code),
    check('units_factor_positive', sql`${t.factorToBase} > 0`),
  ],
);

export const resourceCategories = pgTable(
  'resource_categories',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    parentId: uuid('parent_id').references((): AnyPgColumn => resourceCategories.id, {
      onDelete: 'restrict',
    }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    type: resourceTypeEnum('type').notNull(),
    ...auditColumns(),
  },
  (t) => [uniqueIndex('resource_categories_org_code_unique').on(t.orgId, t.code)],
);

export const resources = pgTable(
  'resources',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    spec: text('spec'),
    categoryId: uuid('category_id').references(() => resourceCategories.id, {
      onDelete: 'restrict',
    }),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'restrict' }),
    type: resourceTypeEnum('type').notNull(),
    /** Procurement lead time, consumed by the capital-requirement model. */
    leadTimeDays: integer('lead_time_days').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    notes: text('notes'),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('resources_org_code_unique').on(t.orgId, t.code),
    index('resources_org_type_idx').on(t.orgId, t.type),
    check('resources_lead_time_nonneg', sql`${t.leadTimeDays} >= 0`),
  ],
);

/**
 * Price book. One row per (resource, scope, price type, effective date).
 *
 * `project_id IS NULL` means the organisation-wide default; a non-null
 * `project_id` overrides it for that project only. Actual purchase prices are
 * never written here — they live on `purchase_items`.
 */
export const resourcePrices = pgTable(
  'resource_prices',
  {
    id: primaryId(),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    priceType: priceTypeEnum('price_type').notNull(),
    price: money('price').notNull(),
    effectiveFrom: day('effective_from').notNull(),
    source: text('source'),
    note: text('note'),
    ...auditColumns(),
  },
  (t) => [
    // Postgres treats NULLs as distinct, so the project-scoped and the
    // organisation-default rows need separate partial unique indexes.
    uniqueIndex('resource_prices_project_scope_unique')
      .on(t.resourceId, t.projectId, t.priceType, t.effectiveFrom)
      .where(sql`${t.projectId} IS NOT NULL`),
    uniqueIndex('resource_prices_org_scope_unique')
      .on(t.resourceId, t.priceType, t.effectiveFrom)
      .where(sql`${t.projectId} IS NULL`),
    // resolvePrice() walks this index backwards from `onDate`.
    index('resource_prices_lookup_idx').on(
      t.resourceId,
      t.priceType,
      t.projectId,
      t.effectiveFrom,
    ),
    check('resource_prices_nonneg', sql`${t.price} >= 0`),
  ],
);

export const suppliers = pgTable(
  'suppliers',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    contact: text('contact'),
    address: text('address'),
    /** Payment terms granted by this supplier; shifts cash-out in the forecast. */
    creditDays: integer('credit_days').notNull().default(0),
    note: text('note'),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('suppliers_org_code_unique').on(t.orgId, t.code),
    check('suppliers_credit_days_nonneg', sql`${t.creditDays} >= 0`),
  ],
);
