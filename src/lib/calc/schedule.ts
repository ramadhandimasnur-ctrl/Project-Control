import {
  addDays,
  differenceInCalendarDays,
  endOfMonth,
  endOfWeek,
  format as formatDate,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { id as localeId } from 'date-fns/locale';

import {
  type Decimal,
  ONE,
  roundPercent,
  safeDivide,
  toDecimal,
  ZERO,
  type Numeric,
} from './decimal';

/**
 * Schedule arithmetic — charter section 5.3.
 *
 * Everything here is pure and works on ISO `yyyy-MM-dd` strings, the same shape
 * the `date` columns hand back. Dates are parsed to local midnight and formatted
 * back the same way, so no value ever crosses a timezone boundary and a project
 * that starts on the 1st cannot come back as the 31st of the month before.
 *
 * Design decision 12: the planned S-curve reads from a frozen baseline, never
 * from the editable plan. This module computes the curve from whichever rows it
 * is handed; choosing which set those are belongs to the service.
 */

export type PeriodType = 'DAY' | 'WEEK' | 'MONTH';

/**
 * Ceiling on generated periods.
 *
 * A five-year project bucketed by day is 1.826 rows, a matrix no one can read
 * and a write no one intended. Refusing with the actual number lets the user
 * pick a coarser bucket rather than discover the problem after the insert.
 */
export const MAX_PERIODS = 520;

export type GeneratedPeriod = {
  seq: number;
  startDate: string;
  endDate: string;
  label: string;
};

const ISO = 'yyyy-MM-dd';
const toISO = (date: Date): string => formatDate(date, ISO);

// --- working calendar -------------------------------------------------------

/**
 * Which days the project actually works.
 *
 * A schedule drawn on calendar days quietly promises Sundays and Idul Fitri.
 * On a six-week job the difference between 42 calendar days and 30 working days
 * is not a rounding error — it is the whole argument about whether the project
 * is late.
 */
export type WorkCalendar = {
  /** True when Saturdays and Sundays count as working days. */
  countWeekends: boolean;
  /** ISO dates excluded regardless of what day of the week they fall on. */
  holidays: ReadonlySet<string>;
};

/**
 * Every day is a working day.
 *
 * The default everywhere a calendar is optional, so behaviour is unchanged for
 * a project that has not configured one — the feature has to be switched on
 * deliberately rather than silently reinterpreting existing schedules.
 */
export const ALL_DAYS: WorkCalendar = { countWeekends: true, holidays: new Set() };

export function isWorkingDay(isoDate: string, calendar: WorkCalendar = ALL_DAYS): boolean {
  if (calendar.holidays.has(isoDate)) return false;
  if (calendar.countWeekends) return true;

  const day = parseISO(isoDate).getDay();
  return day !== 0 && day !== 6;
}

/**
 * Inclusive working-day count between two dates.
 *
 * Returns 0 rather than a negative when the range is inverted, and 0 when every
 * day in it is a holiday — a span with no working days in it genuinely has no
 * duration, and reporting 1 would invent a day of work.
 */
export function workingDaysBetween(
  startDate: string,
  endDate: string,
  calendar: WorkCalendar = ALL_DAYS,
): number {
  const span = differenceInCalendarDays(parseISO(endDate), parseISO(startDate));
  if (span < 0) return 0;

  const start = parseISO(startDate);
  let total = 0;
  for (let offset = 0; offset <= span; offset += 1) {
    if (isWorkingDay(toISO(addDays(start, offset)), calendar)) total += 1;
  }
  return total;
}

/**
 * Inclusive day count: a task that starts and ends today lasts one day.
 *
 * With a calendar, non-working days drop out — which is what a duration is
 * supposed to mean once a project declares that it does not work Sundays.
 */
export function durationBetween(
  startDate: string,
  endDate: string,
  calendar: WorkCalendar = ALL_DAYS,
): number {
  if (calendar === ALL_DAYS || (calendar.countWeekends && calendar.holidays.size === 0)) {
    return differenceInCalendarDays(parseISO(endDate), parseISO(startDate)) + 1;
  }
  return workingDaysBetween(startDate, endDate, calendar);
}

/**
 * The finish date implied by a start and an inclusive duration.
 *
 * With a calendar the walk skips non-working days, so a five-day task starting
 * on a Friday finishes the following Thursday rather than the Tuesday. The
 * start itself is advanced to the first working day: a task cannot begin on a
 * day nobody is on site.
 */
export function finishFromDuration(
  startDate: string,
  durationDays: number,
  calendar: WorkCalendar = ALL_DAYS,
): string {
  if (durationDays < 1) throw new RangeError('Durasi minimal 1 hari.');

  if (calendar.countWeekends && calendar.holidays.size === 0) {
    return toISO(addDays(parseISO(startDate), durationDays - 1));
  }

  let cursor = parseISO(startDate);
  let remaining = durationDays;

  // Bounded so a calendar that somehow excludes every day cannot spin forever.
  const LIMIT = durationDays * 7 + 366;
  for (let step = 0; step < LIMIT; step += 1) {
    if (isWorkingDay(toISO(cursor), calendar)) {
      remaining -= 1;
      if (remaining === 0) return toISO(cursor);
    }
    cursor = addDays(cursor, 1);
  }

  throw new RangeError('Kalender kerja tidak memiliki cukup hari kerja untuk durasi ini.');
}

/**
 * Buckets a project's span into periods.
 *
 * Weeks and months follow the calendar rather than counting from the project's
 * first day: site reports, payroll and supplier terms all run on calendar
 * boundaries, so "Minggu 3" has to mean the same week to everyone reading it.
 * The first and last buckets are therefore usually partial, clipped to the
 * project's own start and end.
 */
export function generatePeriods(
  startDate: string,
  endDate: string,
  periodType: PeriodType,
): GeneratedPeriod[] {
  const projectStart = parseISO(startDate);
  const projectEnd = parseISO(endDate);

  if (differenceInCalendarDays(projectEnd, projectStart) < 0) {
    throw new RangeError('Tanggal selesai proyek mendahului tanggal mulai.');
  }

  const periods: GeneratedPeriod[] = [];
  let cursor = projectStart;
  let seq = 1;

  while (differenceInCalendarDays(cursor, projectEnd) <= 0) {
    const bucketEnd = bucketEndOf(cursor, periodType);
    const clippedEnd = differenceInCalendarDays(bucketEnd, projectEnd) > 0 ? projectEnd : bucketEnd;

    periods.push({
      seq,
      startDate: toISO(cursor),
      endDate: toISO(clippedEnd),
      label: labelFor(cursor, periodType, seq),
    });

    if (periods.length > MAX_PERIODS) {
      throw new RangeError(
        `Rentang proyek menghasilkan lebih dari ${MAX_PERIODS} periode. Pilih satuan periode yang lebih besar.`,
      );
    }

    cursor = addDays(clippedEnd, 1);
    seq += 1;
  }

  return periods;
}

function bucketEndOf(date: Date, periodType: PeriodType): Date {
  switch (periodType) {
    case 'DAY':
      return date;
    case 'WEEK':
      return endOfWeek(date, { weekStartsOn: 1 });
    case 'MONTH':
      return endOfMonth(date);
  }
}

function labelFor(date: Date, periodType: PeriodType, seq: number): string {
  switch (periodType) {
    case 'DAY':
      return formatDate(date, 'd MMM yyyy', { locale: localeId });
    case 'WEEK':
      return `Minggu ${seq}`;
    case 'MONTH':
      return formatDate(date, 'MMMM yyyy', { locale: localeId });
  }
}

/** True when the calendar bucket containing `date` starts before it. */
export function isPartialPeriod(period: GeneratedPeriod, periodType: PeriodType): boolean {
  const start = parseISO(period.startDate);
  const naturalStart =
    periodType === 'WEEK'
      ? startOfWeek(start, { weekStartsOn: 1 })
      : periodType === 'MONTH'
        ? startOfMonth(start)
        : start;
  const naturalEnd = bucketEndOf(start, periodType);

  return (
    differenceInCalendarDays(start, naturalStart) > 0 ||
    differenceInCalendarDays(parseISO(period.endDate), naturalEnd) < 0
  );
}

/**
 * Where the project stands on a given date.
 *
 * Returns the period containing the date; before the project starts that is
 * the first period, after it ends the last. The clamping is deliberate — a
 * screen that opens on "no period" is a dead end, and one that always opens on
 * period 1 shows a project in its twelfth week the figures from its first.
 */
export function periodOn<T extends { startDate: string; endDate: string; seq: number }>(
  periods: readonly T[],
  isoDate: string,
): T | null {
  if (periods.length === 0) return null;

  const ordered = [...periods].sort((a, b) => a.seq - b.seq);
  const containing = ordered.find(
    (period) =>
      differenceInCalendarDays(parseISO(isoDate), parseISO(period.startDate)) >= 0 &&
      differenceInCalendarDays(parseISO(period.endDate), parseISO(isoDate)) >= 0,
  );

  if (containing) return containing;

  const first = ordered[0]!;
  return differenceInCalendarDays(parseISO(isoDate), parseISO(first.startDate)) < 0
    ? first
    : ordered[ordered.length - 1]!;
}

// --- distribution -----------------------------------------------------------

export type PeriodRange = { id: string; startDate: string; endDate: string };

export type DistributionRow = { periodId: string; plannedPct: Decimal };

/**
 * Days of [aStart, aEnd] that also fall inside [bStart, bEnd], inclusive.
 *
 * With a calendar, only working days count. That matters for distribution: a
 * period containing a long holiday should receive less of the work than the
 * one beside it, and counting raw calendar days would hand it the same share.
 */
export function overlapDays(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
  calendar: WorkCalendar = ALL_DAYS,
): number {
  const start = differenceInCalendarDays(parseISO(aStart), parseISO(bStart)) > 0 ? aStart : bStart;
  const end = differenceInCalendarDays(parseISO(aEnd), parseISO(bEnd)) < 0 ? aEnd : bEnd;

  if (calendar.countWeekends && calendar.holidays.size === 0) {
    const days = differenceInCalendarDays(parseISO(end), parseISO(start)) + 1;
    return days > 0 ? days : 0;
  }

  return workingDaysBetween(start, end, calendar);
}

/**
 * Spreads a work item's whole 100% across the periods its planned dates touch,
 * in proportion to how many of its days fall in each.
 *
 * A straight line is the honest default: without progress history there is
 * nothing to justify an S-shaped guess, and the user can reshape any cell
 * afterwards. Periods the item does not touch are left out rather than stored
 * as zeroes, so the matrix stays sparse.
 */
export function distributeByDuration(
  periods: readonly PeriodRange[],
  plannedStart: string,
  plannedFinish: string,
  calendar: WorkCalendar = ALL_DAYS,
): DistributionRow[] {
  if (differenceInCalendarDays(parseISO(plannedFinish), parseISO(plannedStart)) < 0) {
    throw new RangeError('Tanggal selesai pekerjaan mendahului tanggal mulai.');
  }

  const touched = periods
    .map((period) => ({
      periodId: period.id,
      days: overlapDays(plannedStart, plannedFinish, period.startDate, period.endDate, calendar),
    }))
    .filter((entry) => entry.days > 0);

  const totalDays = touched.reduce((acc, entry) => acc + entry.days, 0);
  if (totalDays === 0) return [];

  return normalizeToOne(
    touched.map((entry) => ({
      periodId: entry.periodId,
      plannedPct: safeDivide(entry.days, totalDays) ?? ZERO,
    })),
  );
}

/**
 * Rounds every share to the stored scale and puts the rounding remainder on the
 * largest one, so the row still sums to exactly 1.
 *
 * Three equal periods round to 0,333333 each and lose a millionth. Left alone
 * that gap fails the `Σ = 1` check that guards taking a baseline, over a
 * discrepancy no one can see.
 */
export function normalizeToOne(rows: readonly DistributionRow[]): DistributionRow[] {
  if (rows.length === 0) return [];

  const rounded = rows.map((row) => ({
    periodId: row.periodId,
    plannedPct: roundPercent(row.plannedPct),
  }));

  const total = rounded.reduce<Decimal>((acc, row) => acc.plus(row.plannedPct), ZERO);
  const remainder = ONE.minus(total);
  if (remainder.isZero()) return rounded;

  let largestAt = 0;
  for (let i = 1; i < rounded.length; i += 1) {
    if (rounded[i]!.plannedPct.greaterThan(rounded[largestAt]!.plannedPct)) largestAt = i;
  }

  const target = rounded[largestAt]!;
  rounded[largestAt] = {
    periodId: target.periodId,
    plannedPct: target.plannedPct.plus(remainder),
  };
  return rounded;
}

export type DistributionCheck = {
  workItemId: string;
  total: Decimal;
  /** No rows at all — the item has not been scheduled yet. */
  isEmpty: boolean;
  /** Σ is 1 within tolerance, so the item may enter a baseline. */
  isComplete: boolean;
};

/**
 * Checks the `Σ planned_pct = 1` invariant per work item.
 *
 * Tolerance rather than equality: the column stores six decimals, and an
 * exact comparison would reject a plan that is correct to the millionth.
 */
export function checkDistributions(
  rows: readonly { workItemId: string; plannedPct: Numeric }[],
  workItemIds: readonly string[],
  tolerance: Numeric = '1e-6',
): DistributionCheck[] {
  const totals = new Map<string, Decimal>();
  for (const row of rows) {
    totals.set(row.workItemId, (totals.get(row.workItemId) ?? ZERO).plus(toDecimal(row.plannedPct)));
  }

  return workItemIds.map((workItemId) => {
    const total = totals.get(workItemId) ?? ZERO;
    const isEmpty = !totals.has(workItemId);
    return {
      workItemId,
      total,
      isEmpty,
      isComplete: !isEmpty && total.minus(ONE).abs().lessThanOrEqualTo(toDecimal(tolerance)),
    };
  });
}

// --- S-curve ----------------------------------------------------------------

export type SCurvePoint = {
  periodId: string;
  seq: number;
  label: string;
  /** Share of the whole project planned to be completed within this period. */
  plannedPct: Decimal;
  /** Running total from the first period through this one. */
  cumulativePct: Decimal;
};

/**
 * The planned S-curve: each period's share is `Σ (bobot pekerjaan × porsi
 * periode)`, and the curve is the running total.
 *
 * The result is deliberately not clamped to 1. A curve that climbs past 100%
 * means the weights or the distribution are wrong, and hiding that behind a
 * clamp would make a broken plan look finished.
 */
export function plannedSCurve(
  periods: readonly { id: string; seq: number; label: string }[],
  weights: ReadonlyMap<string, Numeric>,
  distributions: readonly { workItemId: string; periodId: string; plannedPct: Numeric }[],
): SCurvePoint[] {
  const perPeriod = new Map<string, Decimal>();

  for (const row of distributions) {
    const weight = weights.get(row.workItemId);
    if (weight === undefined) continue; // excluded from progress weight
    const contribution = toDecimal(weight).times(toDecimal(row.plannedPct));
    perPeriod.set(row.periodId, (perPeriod.get(row.periodId) ?? ZERO).plus(contribution));
  }

  let running = ZERO;
  return [...periods]
    .sort((a, b) => a.seq - b.seq)
    .map((period) => {
      const plannedPct = perPeriod.get(period.id) ?? ZERO;
      running = running.plus(plannedPct);
      return {
        periodId: period.id,
        seq: period.seq,
        label: period.label,
        plannedPct,
        cumulativePct: running,
      };
    });
}

// --- Gantt geometry ---------------------------------------------------------

export type BarPosition = { offsetPct: Decimal; widthPct: Decimal };

/**
 * Where a bar sits on the timeline, as fractions of the whole span.
 *
 * Returns null when the item falls entirely outside the timeline; a bar drawn
 * at a negative offset would silently overlap the row labels.
 */
export function barPosition(
  timelineStart: string,
  timelineEnd: string,
  barStart: string,
  barFinish: string,
): BarPosition | null {
  const totalDays = durationBetween(timelineStart, timelineEnd);
  if (totalDays <= 0) return null;

  const visibleDays = overlapDays(barStart, barFinish, timelineStart, timelineEnd);
  if (visibleDays === 0) return null;

  const clippedStart =
    differenceInCalendarDays(parseISO(barStart), parseISO(timelineStart)) > 0
      ? barStart
      : timelineStart;

  const offsetDays = differenceInCalendarDays(parseISO(clippedStart), parseISO(timelineStart));

  return {
    offsetPct: safeDivide(offsetDays, totalDays) ?? ZERO,
    widthPct: safeDivide(visibleDays, totalDays) ?? ZERO,
  };
}
