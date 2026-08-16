import {
  type Decimal,
  ZERO,
  clamp,
  roundMoney,
  safeDivide,
  toDecimal,
  type Numeric,
} from './decimal';
import { earnedValue } from './earned-value';

/**
 * Project money — charter section 5.6.
 *
 * Cash is counted, never estimated. Every figure here comes from posted rows:
 * the ledger for what moved, the claims for what was certified. Nothing is
 * inferred from progress alone, because work done and money received are
 * different events and the gap between them is exactly what this module exists
 * to show.
 */

export type CashDirection = 'IN' | 'OUT';

export type InCategory = 'DOWN_PAYMENT' | 'TERMIN' | 'RETENTION_RELEASE' | 'OTHER_IN';
export type OutCategory =
  | 'MATERIAL'
  | 'LABOR'
  | 'EQUIPMENT'
  | 'SUBCON'
  | 'OPERATIONAL'
  | 'TAX'
  | 'OTHER_OUT';
export type CashCategory = InCategory | OutCategory;

export const IN_CATEGORY_LABELS: Record<InCategory, string> = {
  DOWN_PAYMENT: 'Uang muka',
  TERMIN: 'Termin',
  RETENTION_RELEASE: 'Pelepasan retensi',
  OTHER_IN: 'Penerimaan lain',
};

export const OUT_CATEGORY_LABELS: Record<OutCategory, string> = {
  MATERIAL: 'Material',
  LABOR: 'Upah',
  EQUIPMENT: 'Alat',
  SUBCON: 'Subkontraktor',
  OPERATIONAL: 'Operasional',
  TAX: 'Pajak',
  OTHER_OUT: 'Pengeluaran lain',
};

export const CASH_CATEGORY_LABELS: Record<CashCategory, string> = {
  ...IN_CATEGORY_LABELS,
  ...OUT_CATEGORY_LABELS,
};

export type CashRow = {
  periodId: string;
  direction: CashDirection;
  category: CashCategory;
  amount: Numeric;
};

export type PeriodCashflow = {
  periodId: string;
  seq: number;
  label: string;
  inflow: Decimal;
  outflow: Decimal;
  net: Decimal;
  /** Balance carried into the period. */
  opening: Decimal;
  /** Balance at the end of the period. */
  closing: Decimal;
  /** Outflow split by category, for the stacked bars. */
  byCategory: Record<string, Decimal>;
  /** True when the period ends owing more than the project holds. */
  isDeficit: boolean;
};

/**
 * Cash position period by period.
 *
 * The closing balance carries into the next period rather than each period
 * standing alone: a project does not start every month with a fresh purse, and
 * a deficit that appears in March is usually caused by February.
 *
 * Rows landing in no known period are ignored rather than folded into the first
 * one, which would silently move money in time.
 */
export function cashflowByPeriod(
  periods: readonly { id: string; seq: number; label: string }[],
  rows: readonly CashRow[],
  openingBalance: Numeric = 0,
): PeriodCashflow[] {
  const known = new Set(periods.map((period) => period.id));
  const grouped = new Map<string, CashRow[]>();

  for (const row of rows) {
    if (!known.has(row.periodId)) continue;
    const list = grouped.get(row.periodId) ?? [];
    list.push(row);
    grouped.set(row.periodId, list);
  }

  let carried = toDecimal(openingBalance);

  return [...periods]
    .sort((a, b) => a.seq - b.seq)
    .map((period) => {
      const bucket = grouped.get(period.id) ?? [];

      let inflow = ZERO;
      let outflow = ZERO;
      const byCategory: Record<string, Decimal> = {};

      for (const row of bucket) {
        const amount = toDecimal(row.amount);
        if (row.direction === 'IN') inflow = inflow.plus(amount);
        else outflow = outflow.plus(amount);
        byCategory[row.category] = (byCategory[row.category] ?? ZERO).plus(amount);
      }

      const opening = carried;
      const net = inflow.minus(outflow);
      const closing = opening.plus(net);
      carried = closing;

      return {
        periodId: period.id,
        seq: period.seq,
        label: period.label,
        inflow: roundMoney(inflow),
        outflow: roundMoney(outflow),
        net: roundMoney(net),
        opening: roundMoney(opening),
        closing: roundMoney(closing),
        byCategory,
        isDeficit: closing.isNegative(),
      };
    });
}

export type DeficitWarning = {
  periodId: string;
  seq: number;
  label: string;
  /** How much is missing, as a positive number. */
  shortfall: Decimal;
};

/**
 * Periods that end in the red, and by how much.
 *
 * Reported as a positive shortfall rather than a negative balance: the number a
 * project manager needs is how much to raise, and a minus sign in front of it
 * is one more thing to misread under pressure.
 */
export function deficitWarnings(flow: readonly PeriodCashflow[]): DeficitWarning[] {
  return flow
    .filter((period) => period.isDeficit)
    .map((period) => ({
      periodId: period.periodId,
      seq: period.seq,
      label: period.label,
      shortfall: period.closing.abs(),
    }));
}

/** The worst point of the whole project, which is what sizes the facility needed. */
export function peakFunding(flow: readonly PeriodCashflow[]): DeficitWarning | null {
  const deficits = deficitWarnings(flow);
  if (deficits.length === 0) return null;
  return deficits.reduce((worst, current) =>
    current.shortfall.greaterThan(worst.shortfall) ? current : worst,
  );
}

// --- payment claims ---------------------------------------------------------

export type ClaimInput = {
  /** Value the term is measured against, usually the contract value. */
  contractValue: Numeric;
  /** Certified progress as a 0..1 fraction. */
  certifiedProgressPct: Numeric;
  /** Everything already certified on earlier claims, 0..1. */
  previouslyCertifiedPct?: Numeric;
  retentionPercent: Numeric;
  vatPercent: Numeric;
  whtPercent: Numeric;
  /** Share of this claim used to pay back the advance, 0..1. */
  dpRecoupmentPercent?: Numeric;
  /** Advance still outstanding; recoupment never exceeds it. */
  dpOutstanding?: Numeric;
};

export type ClaimBreakdown = {
  grossAmount: Decimal;
  dpRecoupment: Decimal;
  retentionWithheld: Decimal;
  vatAmount: Decimal;
  whtAmount: Decimal;
  netAmount: Decimal;
};

/**
 * What an owner actually pays on a progress claim.
 *
 * Gross is the *increment* since the last certification, not the cumulative
 * figure — billing the full cumulative amount every period is the classic way
 * to invoice the same work twice.
 *
 * Order matters and follows Indonesian practice: retention and the advance
 * recoupment come off the gross, VAT is charged on the gross, and withholding
 * tax is taken from it. Changing the order changes the cheque.
 */
export function claimBreakdown(input: ClaimInput): ClaimBreakdown {
  const contract = toDecimal(input.contractValue);
  const certified = clamp(toDecimal(input.certifiedProgressPct), 0, 1);
  const previous = clamp(toDecimal(input.previouslyCertifiedPct ?? 0), 0, 1);

  // A claim can only bill what is newly certified; a correction downwards
  // yields zero rather than a negative invoice.
  const increment = certified.minus(previous);
  const billable = increment.isNegative() ? ZERO : increment;
  const gross = contract.times(billable);

  const requestedRecoupment = gross.times(toDecimal(input.dpRecoupmentPercent ?? 0));
  const outstanding = toDecimal(input.dpOutstanding ?? 0);
  const dpRecoupment = requestedRecoupment.greaterThan(outstanding)
    ? outstanding
    : requestedRecoupment;

  const retention = gross.times(toDecimal(input.retentionPercent));
  const vat = gross.times(toDecimal(input.vatPercent));
  const wht = gross.times(toDecimal(input.whtPercent));

  const net = gross.minus(dpRecoupment).minus(retention).plus(vat).minus(wht);

  return {
    grossAmount: roundMoney(gross),
    dpRecoupment: roundMoney(dpRecoupment),
    retentionWithheld: roundMoney(retention),
    vatAmount: roundMoney(vat),
    whtAmount: roundMoney(wht),
    netAmount: roundMoney(net),
  };
}

// --- cost variance ----------------------------------------------------------

export type VarianceStatus = 'UNDER' | 'ON_BUDGET' | 'OVER';

export const VARIANCE_STATUS_LABELS: Record<VarianceStatus, string> = {
  UNDER: 'Di bawah anggaran',
  ON_BUDGET: 'Sesuai anggaran',
  OVER: 'Melebihi anggaran',
};

export type CostVariance = {
  /** Budget as sold to the owner. */
  rab: Decimal;
  /** Budget as planned to be executed. */
  rap: Decimal;
  /** What has actually been spent. */
  actual: Decimal;
  /** Earned value: RAP scaled by physical completion. */
  earned: Decimal;
  /** Earned minus actual. Negative means spending ahead of production. */
  costVariance: Decimal;
  /** Cost Performance Index, or null before anything is spent. */
  cpi: Decimal | null;
  /** Projected final cost at the current efficiency. */
  estimateAtCompletion: Decimal | null;
  status: VarianceStatus;
};

/**
 * Cost against budget, measured the only way that means anything mid-project:
 * against the work actually done.
 *
 * Comparing spend to the whole budget flatters every project until the day it
 * runs out of money, so the comparison is to earned value — RAP scaled by
 * physical completion. Spending 40% of the budget is fine at 40% complete and
 * alarming at 15%.
 *
 * `tolerance` is a fraction of earned value within which the difference is
 * treated as noise rather than a finding.
 */
export function costVariance(
  rab: Numeric,
  rap: Numeric,
  actual: Numeric,
  completionPct: Numeric,
  tolerance: Numeric = '0.01',
): CostVariance {
  const rapValue = toDecimal(rap);
  const actualValue = toDecimal(actual);

  /*
   * Earned value, CPI and EAC come from the EVA module rather than being
   * recomputed here. They are the same quantities under different names, and
   * two implementations of the same number are two numbers waiting to disagree
   * — the dashboard would eventually show a different CPI from the capital
   * page with nothing to say which was right.
   *
   * The planned percentage is irrelevant to this function: it reports on cost,
   * and PV only feeds the schedule half of EVA.
   */
  const value = earnedValue({
    budgetAtCompletion: rapValue,
    plannedCumulativePct: 0,
    actualCumulativePct: completionPct,
    actualCost: actualValue,
  });

  const earned = value.ev;
  const variance = value.cv;
  const cpi = value.cpi;
  const estimateAtCompletion = value.eac;

  const band = earned.times(toDecimal(tolerance)).abs();
  const status: VarianceStatus = variance.abs().lessThanOrEqualTo(band)
    ? 'ON_BUDGET'
    : variance.isNegative()
      ? 'OVER'
      : 'UNDER';

  return {
    rab: roundMoney(rab),
    rap: roundMoney(rapValue),
    actual: roundMoney(actualValue),
    earned: roundMoney(earned),
    costVariance: roundMoney(variance),
    cpi,
    estimateAtCompletion: estimateAtCompletion === null ? null : roundMoney(estimateAtCompletion),
    status,
  };
}

/** Margin between what was sold and what it is expected to cost. */
export function projectedMargin(rab: Numeric, estimateAtCompletion: Numeric | null): {
  amount: Decimal;
  percent: Decimal | null;
} {
  const rabValue = toDecimal(rab);
  const eac = toDecimal(estimateAtCompletion ?? 0);
  const amount = rabValue.minus(eac);
  return { amount: roundMoney(amount), percent: safeDivide(amount, rabValue) };
}
