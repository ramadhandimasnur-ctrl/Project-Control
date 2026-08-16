import {
  type Decimal,
  ZERO,
  clamp,
  roundQuantity,
  safeDivide,
  sumBy,
  toDecimal,
  type Numeric,
} from './decimal';

/**
 * Material requirement, stock and wastage — charter section 5.6.
 *
 * The point of this module is the pair of usage figures. Theoretical usage is
 * what the progress recorded so far *should* have consumed, given the RAP
 * coefficients; issued is what actually left the warehouse. The gap between
 * them is wastage, and it is the one number the source Excel system could not
 * produce at all (design decision 5).
 */

/** One work item's demand for a single resource. */
export type RequirementLine = {
  workItemId: string;
  volume: Numeric;
  coefRap: Numeric;
  /** Fraction, e.g. '0.05'. Waste is planned overage, not the same as wastage. */
  wasteFactor?: Numeric;
};

/** Quantity a single work item needs in full. */
export function lineRequirement(line: RequirementLine): Decimal {
  return toDecimal(line.volume)
    .times(toDecimal(line.coefRap))
    .times(toDecimal(1).plus(toDecimal(line.wasteFactor ?? 0)));
}

/** Everything the plan will consume, across every work item. */
export function requirementTotal(lines: readonly RequirementLine[]): Decimal {
  return sumBy(lines, lineRequirement);
}

/**
 * Requirement weighted by how much of each work item a period plans to do.
 *
 * `plannedPct` is read from the active baseline, never from the editable
 * schedule (design decision 12).
 */
export function requirementForPeriod(
  lines: readonly RequirementLine[],
  plannedPctByWorkItem: ReadonlyMap<string, Numeric>,
): Decimal {
  return sumBy(lines, (line) =>
    lineRequirement(line).times(toDecimal(plannedPctByWorkItem.get(line.workItemId) ?? 0)),
  );
}

/**
 * What the progress achieved so far should have consumed.
 *
 * Uses cumulative approved progress per work item, so it moves only when work
 * is actually signed off — not when material happens to leave the store.
 */
export function theoreticalUsage(
  lines: readonly RequirementLine[],
  cumulativePctByWorkItem: ReadonlyMap<string, Numeric>,
): Decimal {
  return sumBy(lines, (line) =>
    lineRequirement(line).times(toDecimal(cumulativePctByWorkItem.get(line.workItemId) ?? 0)),
  );
}

/** Never negative: buying more than planned is surplus, not negative shortage. */
export function shortage(requirement: Numeric, purchased: Numeric): Decimal {
  const gap = toDecimal(requirement).minus(toDecimal(purchased));
  return gap.isNegative() ? toDecimal(0) : gap;
}

/**
 * Material that left the warehouse beyond what the progress justifies.
 *
 * Negative means the opposite and is just as informative: work has been
 * certified that the store has not yet supplied, which usually means an issue
 * was never recorded.
 */
export function wastage(issued: Numeric, theoretical: Numeric): Decimal {
  return toDecimal(issued).minus(toDecimal(theoretical));
}

/** Null when nothing should have been used yet — not zero, and not infinity. */
export function wastagePercent(issued: Numeric, theoretical: Numeric): Decimal | null {
  return safeDivide(wastage(issued, theoretical), theoretical);
}

export type MaterialStatus = 'GREEN' | 'YELLOW' | 'RED';

export const MATERIAL_STATUS_LABELS: Record<MaterialStatus, string> = {
  GREEN: 'Aman',
  YELLOW: 'Perlu dipesan',
  RED: 'Kurang beli',
};

/**
 * Traffic light for procurement, charter section 5.6.
 *
 * RED means the total bought is already behind what the plan needs by the end
 * of the coming period — a purchasing problem. YELLOW means enough has been
 * bought but not enough is on site for the coming period — a delivery problem.
 * The two call for different actions, which is why they are separate.
 */
export function materialStatus(input: {
  purchased: Numeric;
  requirementToDateNextPeriod: Numeric;
  stock: Numeric;
  requirementNextPeriod: Numeric;
}): MaterialStatus {
  if (toDecimal(input.purchased).lessThan(toDecimal(input.requirementToDateNextPeriod))) {
    return 'RED';
  }
  if (toDecimal(input.stock).lessThan(toDecimal(input.requirementNextPeriod))) {
    return 'YELLOW';
  }
  return 'GREEN';
}

export type MaterialSummaryInput = {
  lines: readonly RequirementLine[];
  purchased: Numeric;
  issued: Numeric;
  stock: Numeric;
  /** Cumulative approved progress per work item, for theoretical usage. */
  cumulativePctByWorkItem: ReadonlyMap<string, Numeric>;
  /** From the active baseline, for the traffic light. */
  requirementToDateNextPeriod?: Numeric;
  requirementNextPeriod?: Numeric;
  /** Moving average; falls back to the planned price when nothing is in stock. */
  movingAverageCost?: Numeric | null;
  priceRap?: Numeric | null;
};

export type MaterialSummary = {
  requirementTotal: Decimal;
  purchased: Decimal;
  issued: Decimal;
  theoreticalUsage: Decimal;
  wastage: Decimal;
  wastagePercent: Decimal | null;
  stock: Decimal;
  shortage: Decimal;
  stockValue: Decimal | null;
  purchaseValueRemaining: Decimal | null;
  status: MaterialStatus;
};

/** Everything one row of the material requirement table needs. */
export function summariseMaterial(input: MaterialSummaryInput): MaterialSummary {
  const required = requirementTotal(input.lines);
  const theoretical = theoreticalUsage(input.lines, input.cumulativePctByWorkItem);
  const remaining = shortage(required, input.purchased);

  // Prefer what the material has actually cost; fall back to the planned price
  // when nothing has been bought yet, and report nothing when neither exists.
  const unitCost =
    input.movingAverageCost !== null && input.movingAverageCost !== undefined
      ? toDecimal(input.movingAverageCost)
      : input.priceRap !== null && input.priceRap !== undefined
        ? toDecimal(input.priceRap)
        : null;

  return {
    requirementTotal: required,
    purchased: toDecimal(input.purchased),
    issued: toDecimal(input.issued),
    theoreticalUsage: theoretical,
    wastage: wastage(input.issued, theoretical),
    wastagePercent: wastagePercent(input.issued, theoretical),
    stock: toDecimal(input.stock),
    shortage: remaining,
    stockValue: unitCost === null ? null : toDecimal(input.stock).times(unitCost),
    purchaseValueRemaining: unitCost === null ? null : remaining.times(unitCost),
    status: materialStatus({
      purchased: input.purchased,
      // With no baseline yet, the whole requirement is what the plan needs.
      requirementToDateNextPeriod: input.requirementToDateNextPeriod ?? required,
      stock: input.stock,
      requirementNextPeriod: input.requirementNextPeriod ?? 0,
    }),
  };
}

/** The most critical shortages first, for the dashboard's watch list. */
// --- scope simulation -------------------------------------------------------

export type ScopeLine = {
  resourceId: string;
  resourceCode: string;
  resourceName: string;
  unitCode: string;
  /** The work item's full volume. */
  volume: Numeric;
  coefRap: Numeric;
  wasteFactor: Numeric;
  /** How much of the work item is inside the scope being asked about, 0..1. */
  fraction: Numeric;
  /** Unit price, or null when the price book has no entry in force. */
  priceRap: Numeric | null;
  /** What is already on hand, subtracted once per resource. */
  stock: Numeric;
};

export type ScopeRow = {
  resourceId: string;
  resourceCode: string;
  resourceName: string;
  unitCode: string;
  /** Everything the scope consumes, waste included. */
  required: Decimal;
  stock: Decimal;
  /** Required minus stock, floored at zero — what still has to be bought. */
  toBuy: Decimal;
  priceRap: Decimal | null;
  /** toBuy × price, or null when the price is unknown. */
  cost: Decimal | null;
};

export type ScopeMaterial = {
  rows: ScopeRow[];
  /** Σ of the costs that could be priced. */
  totalCost: Decimal;
  /** Resources with no price in force; the total above understates by these. */
  unpriced: { resourceCode: string; resourceName: string }[];
};

/**
 * Material a slice of the project consumes, and what still has to be bought.
 *
 * Aggregated per resource across every work item in scope: cement appears once
 * with its total, not once per work item that uses it, because the question
 * being asked is a purchasing question.
 *
 * Stock is subtracted once per resource rather than per line — deducting it
 * against each work item separately would spend the same sack of cement several
 * times over and understate the order.
 *
 * A resource with no price contributes quantity but not cost, and is named
 * separately. Pricing it at zero would produce a total that looks complete and
 * is quietly short.
 */
export function materialForScope(lines: readonly ScopeLine[]): ScopeMaterial {
  const byResource = new Map<
    string,
    { line: ScopeLine; required: Decimal }
  >();

  for (const line of lines) {
    const fraction = clamp(toDecimal(line.fraction), 0, 1);
    if (fraction.isZero()) continue;

    const required = lineRequirement({
      workItemId: line.resourceId,
      volume: line.volume,
      coefRap: line.coefRap,
      wasteFactor: line.wasteFactor,
    }).times(fraction);

    const existing = byResource.get(line.resourceId);
    if (existing) existing.required = existing.required.plus(required);
    else byResource.set(line.resourceId, { line, required });
  }

  const rows: ScopeRow[] = [];
  const unpriced: ScopeMaterial['unpriced'] = [];
  let totalCost = ZERO;

  for (const { line, required } of byResource.values()) {
    const stock = toDecimal(line.stock);
    const rawToBuy = required.minus(stock);
    const toBuy = rawToBuy.isNegative() ? ZERO : rawToBuy;
    const price = line.priceRap === null ? null : toDecimal(line.priceRap);
    const cost = price === null ? null : toBuy.times(price);

    if (price === null) {
      unpriced.push({ resourceCode: line.resourceCode, resourceName: line.resourceName });
    } else if (cost !== null) {
      totalCost = totalCost.plus(cost);
    }

    rows.push({
      resourceId: line.resourceId,
      resourceCode: line.resourceCode,
      resourceName: line.resourceName,
      unitCode: line.unitCode,
      required: roundQuantity(required),
      stock: roundQuantity(stock),
      toBuy: roundQuantity(toBuy),
      priceRap: price,
      cost,
    });
  }

  // Biggest spend first: a purchasing list is read from the top and acted on
  // until the budget runs out. Unpriced rows sort by quantity among themselves.
  rows.sort((a, b) => {
    const costOrder = Number(b.cost ?? 0) - Number(a.cost ?? 0);
    return costOrder !== 0 ? costOrder : Number(b.toBuy) - Number(a.toBuy);
  });

  return { rows, totalCost, unpriced };
}

export function rankByShortage<T extends { shortage: Decimal }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => b.shortage.comparedTo(a.shortage));
}

/** Largest wastage first, ignoring resources that are merely under-issued. */
export function rankByWastage<T extends { wastage: Decimal }>(rows: readonly T[]): T[] {
  return [...rows]
    // Strictly greater than zero: decimal.js counts zero as positive, and a
    // resource with no wastage does not belong on a list of what is being
    // wasted.
    .filter((row) => row.wastage.greaterThan(0))
    .sort((a, b) => b.wastage.comparedTo(a.wastage));
}

/**
 * Money still to be spent on material, for the cash forecast.
 *
 * A plain sum: `shortage` is already clamped at zero, so no row can subtract
 * from the total. Rows with no known price contribute nothing rather than
 * being guessed at, which means this is a floor, not a complete figure.
 */
export function totalShortageValue(
  rows: readonly { purchaseValueRemaining: Decimal | null }[],
): Decimal {
  return sumBy(rows, (row) => row.purchaseValueRemaining ?? 0);
}
