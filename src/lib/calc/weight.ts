import { type Decimal, safeDivide, toDecimal, type Numeric } from './decimal';

/**
 * Progress weights — charter section 5.2.
 *
 * Design decision 2: the default basis is contract value, not RAP. The source
 * Excel system weighted by RAP with an uneven markup, so "30% progress" did
 * not mean 30% of the billable value. The basis stays configurable per project.
 */

export type WeightBasis = 'CONTRACT' | 'RAB' | 'RAP';

export type WeightInput = {
  id: string;
  contractValue: Numeric;
  totalRab: Numeric;
  totalRap: Numeric;
  /** Operational and overhead lines carry cost but not progress weight. */
  includeInProgressWeight: boolean;
};

export type WeightResult = {
  id: string;
  basisValue: Decimal;
  weight: Decimal;
};

export function basisValue(item: WeightInput, basis: WeightBasis): Decimal {
  switch (basis) {
    case 'CONTRACT':
      return toDecimal(item.contractValue);
    case 'RAB':
      return toDecimal(item.totalRab);
    case 'RAP':
      return toDecimal(item.totalRap);
  }
}

/**
 * Weights across a project's work items, summing to 1 (or to 0 when no item
 * carries weight — a legitimate state for a project that has no estimate yet,
 * and one that must not divide by zero).
 */
export function computeWeights(
  items: readonly WeightInput[],
  basis: WeightBasis,
): WeightResult[] {
  const included = items.filter((i) => i.includeInProgressWeight);
  const total = included.reduce<Decimal>(
    (acc, item) => acc.plus(basisValue(item, basis)),
    toDecimal(0),
  );

  return items.map((item) => {
    const value = basisValue(item, basis);
    if (!item.includeInProgressWeight) {
      return { id: item.id, basisValue: value, weight: toDecimal(0) };
    }
    const share = safeDivide(value, total);
    return { id: item.id, basisValue: value, weight: share ?? toDecimal(0) };
  });
}

export type WeightReconciliation = {
  /** Σ over every work item, including those excluded from progress weight. */
  sumOfWorkItemContractValues: Decimal;
  declaredContractValue: Decimal;
  difference: Decimal;
  differencePercent: Decimal | null;
  /** True once the gap exceeds 0.1% of the declared contract value. */
  needsAttention: boolean;
};

/**
 * Compares the sum of work-item contract values against the project's declared
 * contract value.
 *
 * Design decision 1: when these disagree the user is warned with the actual
 * figures. Nothing is silently adjusted — an estimate that quietly rewrites
 * the contract is how the source workbook drifted out of balance.
 */
export function reconcileContractValue(
  items: readonly { contractValue: Numeric }[],
  declaredContractValue: Numeric,
  tolerance: Numeric = '0.001',
): WeightReconciliation {
  const sum = items.reduce<Decimal>((acc, i) => acc.plus(toDecimal(i.contractValue)), toDecimal(0));
  const declared = toDecimal(declaredContractValue);
  const difference = sum.minus(declared);
  const differencePercent = safeDivide(difference, declared);

  return {
    sumOfWorkItemContractValues: sum,
    declaredContractValue: declared,
    difference,
    differencePercent,
    needsAttention:
      differencePercent === null
        ? !difference.isZero()
        : differencePercent.abs().greaterThan(toDecimal(tolerance)),
  };
}
