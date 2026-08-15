import { sql } from 'drizzle-orm';
import { date, numeric, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Numeric column helpers.
 *
 * Charter rule 2: money never touches a float. Every one of these returns a
 * Postgres `numeric` and is read into TypeScript as a *string*, which is then
 * handed to decimal.js. Rounding happens only at the presentation layer.
 */

/** Money — numeric(18,2). */
export const money = (name: string) =>
  numeric(name, { precision: 18, scale: 2, mode: 'string' });

/** Quantity / volume — numeric(18,4). */
export const quantity = (name: string) =>
  numeric(name, { precision: 18, scale: 4, mode: 'string' });

/** AHSP coefficient — numeric(18,6). */
export const coefficient = (name: string) =>
  numeric(name, { precision: 18, scale: 6, mode: 'string' });

/**
 * Percentage — numeric(9,6), stored as a 0..1 fraction, never 0..100.
 * Deviation thresholds are the only percentages allowed to be negative.
 */
export const percent = (name: string) =>
  numeric(name, { precision: 9, scale: 6, mode: 'string' });

/** Calendar date with no timezone component (`date`, read as 'YYYY-MM-DD'). */
export const day = (name: string) => date(name, { mode: 'string' });

export const primaryId = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`);

export const createdAtColumn = () =>
  timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();

export const updatedAtColumn = () =>
  timestamp('updated_at', { withTimezone: true, mode: 'date' }).$onUpdate(() => new Date());
