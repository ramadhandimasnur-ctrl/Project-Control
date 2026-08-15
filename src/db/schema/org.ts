import { boolean, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { createdAtColumn, primaryId, updatedAtColumn } from './_shared';
import { globalRoleEnum } from './enums';

export const organizations = pgTable('organizations', {
  id: primaryId(),
  name: text('name').notNull(),
  createdAt: createdAtColumn(),
});

/**
 * Application-side mirror of a Supabase Auth user.
 *
 * `id` is *not* generated here — it is copied from `auth.users.id` so that the
 * session subject and the application user are the same uuid everywhere.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    email: text('email').notNull(),
    fullName: text('full_name').notNull(),
    globalRole: globalRoleEnum('global_role').notNull().default('MEMBER'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [uniqueIndex('users_email_unique').on(t.email)],
);

/**
 * Charter section 4: every transactional table carries created/updated
 * timestamps plus the acting user. Spread this into each table definition.
 */
export const auditColumns = () => ({
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
});
