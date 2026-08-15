import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { coefficient, percent, primaryId } from './_shared';
import { ahspRoleEnum } from './enums';
import { auditColumns, organizations } from './org';
import { resources, units } from './resources';

/**
 * Reusable unit-rate analysis, held at organisation level so a project can
 * start from a library instead of an empty sheet.
 */
export const ahspTemplates = pgTable(
  'ahsp_templates',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'restrict' }),
    notes: text('notes'),
    ...auditColumns(),
  },
  (t) => [uniqueIndex('ahsp_templates_org_code_unique').on(t.orgId, t.code)],
);

export const ahspTemplateResources = pgTable(
  'ahsp_template_resources',
  {
    id: primaryId(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => ahspTemplates.id, { onDelete: 'cascade' }),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'restrict' }),
    role: ahspRoleEnum('role').notNull(),
    coefRab: coefficient('coef_rab').notNull().default('0'),
    coefRap: coefficient('coef_rap').notNull().default('0'),
    wasteFactor: percent('waste_factor').notNull().default('0'),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('ahsp_template_resources_unique').on(t.templateId, t.resourceId, t.role),
    index('ahsp_template_resources_template_idx').on(t.templateId),
    check(
      'ahsp_template_resources_nonneg',
      sql`${t.coefRab} >= 0 AND ${t.coefRap} >= 0 AND ${t.wasteFactor} >= 0`,
    ),
  ],
);
