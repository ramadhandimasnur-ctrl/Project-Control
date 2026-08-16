import { type Decimal, safeDivide, toDecimal, type Numeric } from './decimal';

/**
 * Unit-rate analysis (AHSP) — charter section 5.1.
 *
 * Pure functions over plain values. No database access, no rounding beyond the
 * caller's request: rounding is a presentation concern, and rounding here
 * would compound across thousands of lines.
 */

/** One resource line of an AHSP breakdown, with its resolved prices. */
export type EstimateLine = {
  coefRab: Numeric;
  coefRap: Numeric;
  /** Fraction, e.g. '0.05' for 5% waste. */
  wasteFactor?: Numeric;
  priceRab: Numeric;
  priceRap: Numeric;
};

const wasteMultiplier = (waste: Numeric | undefined): Decimal =>
  toDecimal(1).plus(toDecimal(waste ?? 0));

/** Quantity of a resource needed for the whole work item, at RAB coefficients. */
export function qtyRab(volume: Numeric, coefRab: Numeric, waste?: Numeric): Decimal {
  return toDecimal(volume).times(toDecimal(coefRab)).times(wasteMultiplier(waste));
}

/** Quantity of a resource needed for the whole work item, at RAP coefficients. */
export function qtyRap(volume: Numeric, coefRap: Numeric, waste?: Numeric): Decimal {
  return toDecimal(volume).times(toDecimal(coefRap)).times(wasteMultiplier(waste));
}

/** Cost of one unit of the work item, using budget coefficients and prices. */
export function unitCostRab(lines: readonly EstimateLine[]): Decimal {
  return lines.reduce<Decimal>(
    (acc, line) =>
      acc.plus(
        toDecimal(line.coefRab).times(wasteMultiplier(line.wasteFactor)).times(toDecimal(line.priceRab)),
      ),
    toDecimal(0),
  );
}

/** Cost of one unit of the work item, using execution coefficients and prices. */
export function unitCostRap(lines: readonly EstimateLine[]): Decimal {
  return lines.reduce<Decimal>(
    (acc, line) =>
      acc.plus(
        toDecimal(line.coefRap).times(wasteMultiplier(line.wasteFactor)).times(toDecimal(line.priceRap)),
      ),
    toDecimal(0),
  );
}

export function totalRab(volume: Numeric, lines: readonly EstimateLine[]): Decimal {
  return toDecimal(volume).times(unitCostRab(lines));
}

export function totalRap(volume: Numeric, lines: readonly EstimateLine[]): Decimal {
  return toDecimal(volume).times(unitCostRap(lines));
}

/**
 * Revenue for a work item.
 *
 * Design decision 1: `contractUnitPrice` is the authority. Only when a work
 * item has no contract price does the internal RAB estimate stand in, marked
 * up by the project default.
 */
export function contractValue(
  volume: Numeric,
  contractUnitPrice: Numeric | null | undefined,
  fallbackRab: Numeric,
  markup: Numeric = 0,
): Decimal {
  if (contractUnitPrice !== null && contractUnitPrice !== undefined) {
    return toDecimal(volume).times(toDecimal(contractUnitPrice));
  }
  return toDecimal(fallbackRab).times(toDecimal(1).plus(toDecimal(markup)));
}

export function margin(contract: Numeric, rap: Numeric): Decimal {
  return toDecimal(contract).minus(toDecimal(rap));
}

/** Null when there is no contract value to measure the margin against. */
export function marginPercent(contract: Numeric, rap: Numeric): Decimal | null {
  return safeDivide(margin(contract, rap), contract);
}

export type WorkItemEstimate = {
  unitCostRab: Decimal;
  unitCostRap: Decimal;
  totalRab: Decimal;
  totalRap: Decimal;
  contractValue: Decimal;
  margin: Decimal;
  marginPercent: Decimal | null;
  /** totalRab − totalRap: how much cheaper execution is planned to be. */
  estimateSpread: Decimal;
  estimateSpreadPercent: Decimal | null;
};

/** Everything the AHSP footer and the RAB/RAP comparison table need. */
export function estimateWorkItem(input: {
  volume: Numeric;
  lines: readonly EstimateLine[];
  contractUnitPrice?: Numeric | null;
  markup?: Numeric;
  /**
   * Unit prices typed directly on the work item.
   *
   * Used only when the item has no analysis lines. A work item with an AHSP is
   * priced by its AHSP — letting a typed figure override it would give the
   * same work two different unit rates depending on which screen you opened,
   * and the analysis panel would stop explaining the number beside it.
   *
   * This exists because not every job earns a full breakdown: a lump-sum
   * mobilisation line has a price and no meaningful analysis, and forcing one
   * invents detail nobody costed.
   */
  directUnitRab?: Numeric | null;
  directUnitRap?: Numeric | null;
}): WorkItemEstimate {
  const {
    volume,
    lines,
    contractUnitPrice = null,
    markup = 0,
    directUnitRab = null,
    directUnitRap = null,
  } = input;

  const hasLines = lines.length > 0;

  const rabUnit = hasLines
    ? unitCostRab(lines)
    : toDecimal(directUnitRab ?? directUnitRap ?? 0);
  const rapUnit = hasLines
    ? unitCostRap(lines)
    : toDecimal(directUnitRap ?? directUnitRab ?? 0);
  const rab = toDecimal(volume).times(rabUnit);
  const rap = toDecimal(volume).times(rapUnit);
  const contract = contractValue(volume, contractUnitPrice, rab, markup);

  return {
    unitCostRab: rabUnit,
    unitCostRap: rapUnit,
    totalRab: rab,
    totalRap: rap,
    contractValue: contract,
    margin: contract.minus(rap),
    marginPercent: safeDivide(contract.minus(rap), contract),
    estimateSpread: rab.minus(rap),
    estimateSpreadPercent: safeDivide(rab.minus(rap), rab),
  };
}
