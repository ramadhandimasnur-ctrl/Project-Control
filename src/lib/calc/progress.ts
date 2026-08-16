import {
  type Decimal,
  ONE,
  clamp,
  roundPercent,
  roundQuantity,
  safeDivide,
  toDecimal,
  ZERO,
  type Numeric,
} from './decimal';

/**
 * Physical progress — charter section 5.4.
 *
 * Two rules shape everything here.
 *
 * Only approved progress counts. A draft is someone's claim; the actual
 * S-curve, the deviation and every figure derived from them read approved rows
 * only, so a supervisor's unreviewed entry can never move the number a client
 * is shown.
 *
 * Progress never runs backwards past 100%. A work item's cumulative share is
 * bounded at 1: the underlying quantity may legitimately overshoot the
 * estimate, but "115% complete" is not a thing anyone can be paid for.
 */

export type ProgressMethod = 'VOLUME' | 'PERCENT' | 'MILESTONE';

export type ProgressInput = {
  method: ProgressMethod;
  /** What the user typed when the method is VOLUME. */
  qtyThisPeriod?: Numeric | null;
  /** What the user typed when the method is PERCENT or MILESTONE. */
  pctThisPeriod?: Numeric | null;
};

export type DerivedProgress = { qtyThisPeriod: Decimal; pctThisPeriod: Decimal };

/**
 * Fills in whichever of quantity and percentage the user did not type.
 *
 * Both are stored. Deriving one at read time would let a later edit of
 * `work_items.volume` silently rewrite history: the same 40 m³ poured last
 * month would start reporting a different percentage.
 */
export function deriveProgress(input: ProgressInput, volume: Numeric): DerivedProgress {
  const total = toDecimal(volume);

  if (input.method === 'VOLUME') {
    const qty = toDecimal(input.qtyThisPeriod ?? 0);
    // A work item with no volume yet cannot express a share, and inventing one
    // would be a fabricated number.
    const pct = safeDivide(qty, total) ?? ZERO;
    return { qtyThisPeriod: roundQuantity(qty), pctThisPeriod: roundPercent(clamp(pct, 0, 1)) };
  }

  const pct = clamp(toDecimal(input.pctThisPeriod ?? 0), 0, 1);
  return { qtyThisPeriod: roundQuantity(pct.times(total)), pctThisPeriod: roundPercent(pct) };
}

/**
 * Progress implied by the milestones ticked off so far.
 *
 * Milestone weights are a share of the work item, so the sum of the completed
 * ones is the item's completion. They are not required to add up to 1 — a
 * half-specified checklist should report what it actually covers rather than
 * be scaled up into a claim nobody made.
 */
export function progressFromMilestones(
  milestones: readonly { id: string; weight: Numeric }[],
  completedIds: readonly string[],
): Decimal {
  const done = new Set(completedIds);
  const total = milestones
    .filter((milestone) => done.has(milestone.id))
    .reduce<Decimal>((acc, milestone) => acc.plus(toDecimal(milestone.weight)), ZERO);
  return roundPercent(clamp(total, 0, 1));
}

// --- cumulative -------------------------------------------------------------

export type EntryRow = {
  workItemId: string;
  periodId: string;
  pctThisPeriod: Numeric;
};

export type ItemCompletion = {
  workItemId: string;
  /** Σ of the item's approved periods, bounded at 1. */
  completion: Decimal;
  /** True when the raw sum went past 100% before being capped. */
  overshoots: boolean;
};

export function completionByItem(
  entries: readonly EntryRow[],
  workItemIds: readonly string[],
): ItemCompletion[] {
  const totals = new Map<string, Decimal>();
  for (const entry of entries) {
    totals.set(
      entry.workItemId,
      (totals.get(entry.workItemId) ?? ZERO).plus(toDecimal(entry.pctThisPeriod)),
    );
  }

  return workItemIds.map((workItemId) => {
    const raw = totals.get(workItemId) ?? ZERO;
    return {
      workItemId,
      completion: clamp(raw, 0, 1),
      overshoots: raw.greaterThan(ONE),
    };
  });
}

/**
 * How much of a work item is still available to report in a given period.
 *
 * Cumulative completion is checked across rows, which no column constraint can
 * do, so the service asks this before accepting an entry.
 */
export function remainingFor(
  entries: readonly EntryRow[],
  workItemId: string,
  exceptPeriodId: string | null,
): Decimal {
  const used = entries
    .filter(
      (entry) =>
        entry.workItemId === workItemId &&
        (exceptPeriodId === null || entry.periodId !== exceptPeriodId),
    )
    .reduce<Decimal>((acc, entry) => acc.plus(toDecimal(entry.pctThisPeriod)), ZERO);

  const left = ONE.minus(used);
  return left.isNegative() ? ZERO : left;
}

// --- weighted columns -------------------------------------------------------

export type WeightedProgress = {
  /** Contribution already earned in earlier periods. */
  previous: Decimal;
  /** Contribution earned in this period alone. */
  current: Decimal;
  /** Everything earned through the end of this period. */
  cumulative: Decimal;
  /** What the plan expected to be earned by now. */
  planned: Decimal;
  /** Realised minus planned. Negative means behind. */
  deviation: Decimal;
};

/**
 * One work item's columns on a weekly report: last period, this period, to
 * date, and the gap against plan.
 *
 * Every figure is weighted — a share of the whole project, not of the item.
 * That is what makes the column addable: the sum down the page is the project's
 * progress, which is the number the report exists to justify. An item's own
 * percentage cannot be summed with its neighbours and means nothing on its own
 * line of a billing document.
 */
export function weightedProgress(
  weight: Numeric,
  completedBefore: Numeric,
  pctThisPeriod: Numeric,
  plannedCumulative: Numeric,
): WeightedProgress {
  const share = toDecimal(weight);

  const previous = share.times(clamp(toDecimal(completedBefore), 0, 1));
  const current = share.times(clamp(toDecimal(pctThisPeriod), 0, 1));

  // Capped at the item's own weight: an item cannot contribute more to the
  // project than it is worth, however the two halves were recorded.
  const rawCumulative = previous.plus(current);
  const cumulative = rawCumulative.greaterThan(share) ? share : rawCumulative;

  const planned = share.times(clamp(toDecimal(plannedCumulative), 0, 1));

  return { previous, current, cumulative, planned, deviation: cumulative.minus(planned) };
}

// --- actual S-curve ---------------------------------------------------------

export type CurvePoint = {
  periodId: string;
  seq: number;
  label: string;
  pct: Decimal;
  cumulativePct: Decimal;
};

/**
 * The realised S-curve: each period's share is `Σ (bobot pekerjaan × porsi
 * dilaporkan)`, and the curve is the running total.
 *
 * Periods after the last reported one are still returned, carrying the same
 * cumulative value. A curve that simply stops is indistinguishable from one
 * that has stalled, and the difference matters.
 */
export function actualSCurve(
  periods: readonly { id: string; seq: number; label: string }[],
  weights: ReadonlyMap<string, Numeric>,
  entries: readonly EntryRow[],
): CurvePoint[] {
  const perPeriod = new Map<string, Decimal>();

  for (const entry of entries) {
    const weight = weights.get(entry.workItemId);
    if (weight === undefined) continue; // carries no progress weight
    const contribution = toDecimal(weight).times(toDecimal(entry.pctThisPeriod));
    perPeriod.set(entry.periodId, (perPeriod.get(entry.periodId) ?? ZERO).plus(contribution));
  }

  let running = ZERO;
  return [...periods]
    .sort((a, b) => a.seq - b.seq)
    .map((period) => {
      const pct = perPeriod.get(period.id) ?? ZERO;
      running = running.plus(pct);
      return {
        periodId: period.id,
        seq: period.seq,
        label: period.label,
        pct,
        cumulativePct: running,
      };
    });
}

// --- deviation --------------------------------------------------------------

export type ProgressStatus = 'AHEAD' | 'ON_TRACK' | 'WARNING' | 'DELAYED';

export const PROGRESS_STATUS_LABELS: Record<ProgressStatus, string> = {
  AHEAD: 'Lebih cepat',
  ON_TRACK: 'Sesuai rencana',
  WARNING: 'Perlu perhatian',
  DELAYED: 'Terlambat',
};

export type Thresholds = {
  /** Negative fraction, e.g. -0.005 for half a percent behind. */
  warning: Numeric;
  /** Negative fraction, e.g. -0.05 for five percent behind. */
  delayed: Numeric;
};

/**
 * Where the project stands against its plan, as a fraction of the whole scope.
 *
 * Positive is ahead. The thresholds are project configuration rather than
 * constants: half a percent behind is nothing on a two-year job and serious on
 * a six-week one.
 */
export function deviationStatus(
  plannedCumulative: Numeric,
  actualCumulative: Numeric,
  thresholds: Thresholds,
): { deviation: Decimal; status: ProgressStatus } {
  const deviation = toDecimal(actualCumulative).minus(toDecimal(plannedCumulative));
  const warning = toDecimal(thresholds.warning);
  const delayed = toDecimal(thresholds.delayed);

  if (deviation.greaterThan(0)) return { deviation, status: 'AHEAD' };
  if (deviation.greaterThanOrEqualTo(warning)) return { deviation, status: 'ON_TRACK' };
  if (deviation.greaterThanOrEqualTo(delayed)) return { deviation, status: 'WARNING' };
  return { deviation, status: 'DELAYED' };
}

/**
 * Schedule Performance Index: realised over planned.
 *
 * Null before the plan expects anything — dividing by a plan of zero would
 * report a project as infinitely ahead on its first day.
 */
export function schedulePerformanceIndex(
  plannedCumulative: Numeric,
  actualCumulative: Numeric,
): Decimal | null {
  return safeDivide(actualCumulative, plannedCumulative);
}

export type ComparisonPoint = {
  periodId: string;
  seq: number;
  label: string;
  plannedCumulative: Decimal;
  actualCumulative: Decimal;
  deviation: Decimal;
  status: ProgressStatus;
  /** Null once the period is beyond what has been reported. */
  spi: Decimal | null;
};

/**
 * Plan against reality, period by period.
 *
 * Periods past the last reported one are marked by a null SPI rather than
 * being scored as a total failure: nothing has been reported yet because the
 * date has not arrived, which is not the same as nothing having been done.
 */
export function compareCurves(
  planned: readonly { periodId: string; seq: number; label: string; cumulativePct: Numeric }[],
  actual: readonly { periodId: string; cumulativePct: Numeric }[],
  thresholds: Thresholds,
  lastReportedSeq: number | null,
): ComparisonPoint[] {
  const actualBy = new Map(actual.map((point) => [point.periodId, toDecimal(point.cumulativePct)]));

  return [...planned]
    .sort((a, b) => a.seq - b.seq)
    .map((point) => {
      const actualCumulative = actualBy.get(point.periodId) ?? ZERO;
      const reported = lastReportedSeq !== null && point.seq <= lastReportedSeq;
      const { deviation, status } = deviationStatus(
        point.cumulativePct,
        actualCumulative,
        thresholds,
      );

      return {
        periodId: point.periodId,
        seq: point.seq,
        label: point.label,
        plannedCumulative: toDecimal(point.cumulativePct),
        actualCumulative,
        deviation,
        status,
        spi: reported ? schedulePerformanceIndex(point.cumulativePct, actualCumulative) : null,
      };
    });
}
