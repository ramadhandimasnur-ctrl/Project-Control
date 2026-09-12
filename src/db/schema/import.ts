import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { primaryId } from './_shared';
import { organizations } from './org';

/**
 * Which workbook row became which row here.
 *
 * The workbook identifies everything by its own keys — PRJ-0048, MDR-00001,
 * PER-003393 — and this application by uuid. Without a record of the pairing a
 * second import would either duplicate everything or have to guess at matches
 * by name, and a workbook with two suppliers both called "Toko Jaya" would
 * quietly become one.
 *
 * It is also what makes an import repeatable. Re-importing a corrected
 * workbook is the normal way to work, not an exception: the same source row
 * finds the same target row and updates it.
 */
export const importRefs = pgTable(
  'import_refs',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** Which workbook, so two files cannot collide on PRJ-0001. */
    source: text('source').notNull(),
    sourceTable: text('source_table').notNull(),
    sourceId: text('source_id').notNull(),
    targetTable: text('target_table').notNull(),
    targetId: uuid('target_id').notNull(),
    firstImportedAt: timestamp('first_imported_at', { withTimezone: true }).notNull().defaultNow(),
    lastImportedAt: timestamp('last_imported_at', { withTimezone: true }).notNull().defaultNow(),
    lastBatch: text('last_batch'),
  },
  (t) => [
    uniqueIndex('import_refs_source_unique').on(t.orgId, t.source, t.sourceTable, t.sourceId),
    // "What did this project come from" is asked as often as "where did
    // PRJ-0048 go".
    index('import_refs_target_idx').on(t.targetTable, t.targetId),
  ],
);
