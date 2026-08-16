import { type Decimal, clamp, safeDivide, toDecimal, ZERO, type Numeric } from './decimal';

/**
 * What it costs to reach a progress target.
 *
 * The question this answers is the one that decides whether a project can
 * proceed next month: "we are at 27% and the term is paid at 50% — which work
 * has to be finished, and how much cash does that take?"
 *
 * Answered in plan order rather than by picking the cheapest items that add up
 * to the target. The cheapest set is arithmetically valid and operationally
 * fiction: work happens in the sequence the schedule allows, and a foundation
 * cannot be skipped because a partition wall carries the same weight for less
 * money.
 */

export type SimulationCandidate = {
  workItemId: string;
  code: string;
  name: string;
  /** The item's share of the whole project, 0..1. */
  weight: Numeric;
  totalRab: Numeric;
  totalRap: Numeric;
  /** Approved completion of this item so far, 0..1. */
  completed: Numeric;
  /** Position in the plan; lower comes first. */
  order: number;
};

export type SimulationRow = {
  workItemId: string;
  code: string;
  name: string;
  weight: Decimal;
  completed: Decimal;
  /** Fraction of the item still to do for the target, 0..1. */
  requiredFraction: Decimal;
  /** Weight this contributes toward the target. */
  weightGained: Decimal;
  costRab: Decimal;
  costRap: Decimal;
  /** True when only part of the item is needed to hit the target exactly. */
  isPartial: boolean;
};

export type CapitalSimulation = {
  targetWeight: Decimal;
  /** Approved progress right now. */
  currentWeight: Decimal;
  /** How much more is needed; zero when the target is already met. */
  gap: Decimal;
  rows: SimulationRow[];
  totalRab: Decimal;
  totalRap: Decimal;
  /**
   * False when finishing every remaining item still falls short.
   *
   * Only possible when the work items do not carry the full weight of the
   * project between them, which is itself worth surfacing.
   */
  achievable: boolean;
  /** The most the remaining work can reach. */
  reachableWeight: Decimal;
};

/**
 * Work needed to move from today's progress to a target, and its cost.
 *
 * Cost is prorated linearly against the fraction of the item required. A work
 * item half done is charged half its budget — not true to the rupiah, since
 * mobilisation is front-loaded, but it is the only split the data supports and
 * inventing an S-shaped cost curve here would be a fabricated number dressed as
 * precision.
 */
export function simulateCapitalNeed(
  candidates: readonly SimulationCandidate[],
  targetWeight: Numeric,
): CapitalSimulation {
  const target = clamp(toDecimal(targetWeight), 0, 1);

  /*
   * Items outside the progress weight are dropped entirely. They carry no
   * share, so listing them would show work that cannot move the number the
   * user is targeting.
   */
  const weighted = candidates
    .filter((candidate) => toDecimal(candidate.weight).greaterThan(0))
    .map((candidate) => ({
      ...candidate,
      weightDecimal: toDecimal(candidate.weight),
      completedDecimal: clamp(toDecimal(candidate.completed), 0, 1),
    }))
    .sort((a, b) => a.order - b.order || a.code.localeCompare(b.code));

  const currentWeight = weighted.reduce<Decimal>(
    (acc, item) => acc.plus(item.weightDecimal.times(item.completedDecimal)),
    ZERO,
  );

  const totalWeight = weighted.reduce<Decimal>((acc, item) => acc.plus(item.weightDecimal), ZERO);

  const rows: SimulationRow[] = [];
  let running = currentWeight;

  for (const item of weighted) {
    if (running.greaterThanOrEqualTo(target)) break;

    const available = item.weightDecimal.times(toDecimal(1).minus(item.completedDecimal));
    if (available.lessThanOrEqualTo(0)) continue;

    const needed = target.minus(running);
    const take = needed.lessThan(available) ? needed : available;

    // Guarded although the filter above rules out a zero weight: this is the
    // divisor that turns weight back into a share of the item.
    const requiredFraction = safeDivide(take, item.weightDecimal) ?? ZERO;

    rows.push({
      workItemId: item.workItemId,
      code: item.code,
      name: item.name,
      weight: item.weightDecimal,
      completed: item.completedDecimal,
      requiredFraction,
      weightGained: take,
      costRab: toDecimal(item.totalRab).times(requiredFraction),
      costRap: toDecimal(item.totalRap).times(requiredFraction),
      isPartial: take.lessThan(available),
    });

    running = running.plus(take);
  }

  return {
    targetWeight: target,
    currentWeight,
    gap: target.greaterThan(currentWeight) ? target.minus(currentWeight) : ZERO,
    rows,
    totalRab: rows.reduce<Decimal>((acc, row) => acc.plus(row.costRab), ZERO),
    totalRap: rows.reduce<Decimal>((acc, row) => acc.plus(row.costRap), ZERO),
    achievable: running.greaterThanOrEqualTo(target),
    reachableWeight: totalWeight,
  };
}
