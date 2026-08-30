import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { coefficient, primaryId } from './_shared';
import { ahspRoleEnum } from './enums';
import { auditColumns, organizations } from './org';

/**
 * A published unit-rate analysis, copied in and left alone.
 *
 * Distinct from `ahsp_templates`, which are an organisation's own saved
 * analyses and are meant to be edited. This is a reference: the national AHSP
 * (Cipta Karya / SNI) and anything else with an issuing authority behind it.
 * Two rules follow from that and shape the whole table.
 *
 * Provenance travels with the row. An estimator challenged on a coefficient
 * has to be able to answer "SE Bina Konstruksi, 2023, sheet X row Y", and a
 * figure that cannot cite its source is worth less than no figure at all.
 *
 * Prices are deliberately absent. Published analyses carry example unit prices
 * from wherever they were compiled, and importing those would put a stranger's
 * market rates into your estimates under the authority of the standard. Only
 * the coefficients are the standard; the prices are yours.
 */
export const ahspLibraryEntries = pgTable(
  'ahsp_library_entries',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    /** Free text, not a unit id: the source names its own units. */
    unitCode: text('unit_code').notNull(),

    sourceName: text('source_name'),
    sourceYear: integer('source_year'),
    sourceDocument: text('source_document'),
    sourceSheet: text('source_sheet'),
    sourceRow: integer('source_row'),
    sourceUrl: text('source_url'),
    /*
     * Which import produced this row. A re-import that changes a coefficient
     * has to be attributable to the file it came from, and a batch that turns
     * out to be wrong has to be findable as a whole.
     */
    importBatch: text('import_batch'),

    isActive: boolean('is_active').notNull().default(true),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('ahsp_library_entries_org_code_unique').on(t.orgId, t.code),
    index('ahsp_library_entries_org_idx').on(t.orgId),
  ],
);

/**
 * One resource line of a published analysis.
 *
 * Resources are held as code and name rather than as a foreign key. The
 * library describes what the standard says; whether this organisation happens
 * to stock a matching resource is a separate question, answered when the entry
 * is applied. Requiring the catalogue to be complete before the library could
 * be imported would make the library impossible to import at all.
 */
export const ahspLibraryItems = pgTable(
  'ahsp_library_items',
  {
    id: primaryId(),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => ahspLibraryEntries.id, { onDelete: 'cascade' }),
    role: ahspRoleEnum('role').notNull(),
    /*
     * Nullable, because the source mostly is. Only 590 of the national
     * library's 16.136 lines carry a resource code; the rest name the material
     * and leave it at that. Recording that absence honestly is what lets the
     * matching step report what it could not resolve.
     */
    resourceCode: text('resource_code'),
    resourceName: text('resource_name').notNull(),
    unitCode: text('unit_code').notNull(),
    coef: coefficient('coef').notNull().default('0'),
    sortOrder: integer('sort_order').notNull().default(0),
    notes: text('notes'),
    ...auditColumns(),
  },
  (t) => [
    index('ahsp_library_items_entry_idx').on(t.entryId),
    index('ahsp_library_items_code_idx').on(t.resourceCode),
    check('ahsp_library_items_coef_nonneg', sql`${t.coef} >= 0`),
  ],
);
