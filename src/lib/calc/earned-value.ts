import { type Decimal, clamp, safeDivide, toDecimal, ZERO, type Numeric } from './decimal';

/**
 * Earned Value Analysis.
 *
 * Three figures, and everything else follows from them: what the plan said
 * should have been done by now, what has actually been done, and what it cost
 * to do it. The value of EVA is that it separates the two ways a project goes
 * wrong — being late and being expensive — which a single "we have spent 60% of
 * the budget" figure hides completely.
 *
 * The budget at completion is RAP, the contractor's own execution budget. It
 * has to be, because actual cost is money spent: measuring earned value against
 * the contract price while spending is measured against cost would make CPI a
 * comparison of two different things and quietly flatter every project.
 */

export type EarnedValueInput = {
  /** Budget at completion — total RAP. */
  budgetAtCompletion: Numeric;
  /** What the plan expects to be complete by now, 0..1. */
  plannedCumulativePct: Numeric;
  /** What is actually approved as complete, 0..1. */
  actualCumulativePct: Numeric;
  /** Money genuinely spent so far, from the cash ledger. */
  actualCost: Numeric;
};

export type EarnedValue = {
  /** Planned Value: budgeted cost of the work scheduled. */
  pv: Decimal;
  /** Earned Value: budgeted cost of the work performed. */
  ev: Decimal;
  /** Actual Cost of the work performed. */
  ac: Decimal;
  /** Cost Variance, EV − AC. Negative means overspending. */
  cv: Decimal;
  /** Schedule Variance, EV − PV, in money. Negative means behind. */
  sv: Decimal;
  /** Cost Performance Index, EV / AC. Below 1 means overspending. */
  cpi: Decimal | null;
  /** Schedule Performance Index, EV / PV. Below 1 means behind. */
  spi: Decimal | null;
  /** Estimate At Completion: BAC / CPI, the cost if the trend holds. */
  eac: Decimal | null;
  /** Estimate To Complete: what is left to spend under that trend. */
  etc: Decimal | null;
  /** Variance At Completion: BAC − EAC. Negative means an overrun. */
  vac: Decimal | null;
};

/**
 * Every EVA figure from the four inputs.
 *
 * The indices are null rather than zero when their denominator is zero. A
 * project that has spent nothing is not infinitely efficient, and a project
 * whose plan expects nothing yet is not infinitely ahead — on day one both
 * would otherwise report a triumph.
 */
export function earnedValue(input: EarnedValueInput): EarnedValue {
  const bac = toDecimal(input.budgetAtCompletion);
  const pv = bac.times(clamp(toDecimal(input.plannedCumulativePct), 0, 1));
  const ev = bac.times(clamp(toDecimal(input.actualCumulativePct), 0, 1));
  const ac = toDecimal(input.actualCost);

  const cpi = safeDivide(ev, ac);
  const spi = safeDivide(ev, pv);

  /*
   * EAC uses the CPI trend: the classic BAC / CPI. It assumes the rest of the
   * project behaves like the part already done, which is an assumption worth
   * naming — it is a projection, not a forecast anyone has committed to.
   */
  const eac = cpi === null ? null : safeDivide(bac, cpi);

  return {
    pv,
    ev,
    ac,
    cv: ev.minus(ac),
    sv: ev.minus(pv),
    cpi,
    spi,
    eac,
    etc: eac === null ? null : eac.minus(ac),
    vac: eac === null ? null : bac.minus(eac),
  };
}

export type PerformanceVerdict = 'GOOD' | 'WATCH' | 'BAD' | 'UNKNOWN';

export const PERFORMANCE_LABELS: Record<PerformanceVerdict, string> = {
  GOOD: 'Sehat',
  WATCH: 'Perlu perhatian',
  BAD: 'Bermasalah',
  UNKNOWN: 'Belum terukur',
};

/**
 * Reads an index as a verdict.
 *
 * The 0,95 threshold is the usual construction convention: a five percent slip
 * is noise on most jobs and the point at which it stops being noise is a
 * judgement, not a computation. Null stays UNKNOWN rather than defaulting to
 * good — "we cannot tell yet" is the honest answer, and dressing it up as
 * healthy is exactly how an early warning gets missed.
 */
export function performanceVerdict(index: Decimal | null): PerformanceVerdict {
  if (index === null) return 'UNKNOWN';
  if (index.greaterThanOrEqualTo(1)) return 'GOOD';
  if (index.greaterThanOrEqualTo('0.95')) return 'WATCH';
  return 'BAD';
}

/** Serialisable form, for crossing the server boundary. */
export type EarnedValueStrings = {
  [K in keyof EarnedValue]: EarnedValue[K] extends Decimal | null ? string | null : string;
};

export function toStrings(value: EarnedValue): EarnedValueStrings {
  const asString = (decimal: Decimal | null) => (decimal === null ? null : decimal.toString());

  return {
    pv: value.pv.toString(),
    ev: value.ev.toString(),
    ac: value.ac.toString(),
    cv: value.cv.toString(),
    sv: value.sv.toString(),
    cpi: asString(value.cpi),
    spi: asString(value.spi),
    eac: asString(value.eac),
    etc: asString(value.etc),
    vac: asString(value.vac),
  };
}

/** Nothing measured yet — used when a project has no budget to speak of. */
export const EMPTY_EARNED_VALUE: EarnedValue = {
  pv: ZERO,
  ev: ZERO,
  ac: ZERO,
  cv: ZERO,
  sv: ZERO,
  cpi: null,
  spi: null,
  eac: null,
  etc: null,
  vac: null,
};
