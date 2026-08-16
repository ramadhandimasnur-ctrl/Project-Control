import { sql } from 'drizzle-orm';
import { boolean, check, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { createdAtColumn, primaryId, updatedAtColumn } from './_shared';
import { globalRoleEnum, userStatusEnum } from './enums';

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
    /** Display handle chosen at registration. Email remains the credential. */
    username: text('username'),
    globalRole: globalRoleEnum('global_role').notNull().default('MEMBER'),
    status: userStatusEnum('status').notNull().default('ACTIVE'),
    isActive: boolean('is_active').notNull().default(true),
    /** Who approved or rejected, and when — the decision has to be traceable. */
    reviewedBy: uuid('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex('users_email_unique').on(t.email),
    uniqueIndex('users_username_unique').on(t.username),
    /*
     * The invariant that keeps the workflow honest.
     *
     * `is_active` is what the session and every RLS helper actually read, and
     * `status` is what the admin screen shows. Written separately they would
     * eventually disagree — a rejected account still able to sign in, or an
     * active one locked out — so the database refuses the combination rather
     * than trusting every future caller to set both.
     */
    check('users_status_matches_active', sql`${t.isActive} = (${t.status} = 'ACTIVE')`),
  ],
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
