/**
 * Domain dates, as the `date` columns store them: ISO `yyyy-MM-dd`, no time,
 * no zone.
 *
 * Separate from lib/format, which is presentation only. A value from here is
 * used to decide things — which price applies on a given day — not to show.
 */

/**
 * Today, for defaulting an "as of" date.
 *
 * Beware: this reads the calendar in UTC. A server running in UTC will call it
 * "yesterday" until 07:00 WIB, so a price entered as effective today would not
 * resolve for the first seven hours of an Indonesian working day. Getting this
 * right needs a timezone on the project rather than a guess here, so the
 * behaviour is left as it was and the hazard written down instead of hidden.
 */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
