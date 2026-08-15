import { type Decimal, safeDivide, toDecimal, type Numeric } from './decimal';

/**
 * Inventory valuation — charter section 5.7.
 *
 * Costing is weighted moving average, not FIFO (design decision 6). The
 * average is recomputed on every receipt and every issue is valued at whatever
 * average was in force at that moment, so the ledger can be replayed from the
 * raw movements and always produce the same numbers.
 *
 * Nothing here is stored: stock, average cost and stock value are derived from
 * the movement list every time (charter rule 4). That is what makes a
 * corrected back-dated entry re-price history correctly instead of leaving a
 * stale running total behind.
 */

export type MovementType = 'IN' | 'OUT' | 'ADJUSTMENT' | 'RETURN' | 'TRANSFER';

export type InventoryMovement = {
  id?: string;
  txnType: MovementType;
  /**
   * Positive for every type except ADJUSTMENT, which may be negative to record
   * a stock count that found less than the books claim.
   */
  qty: Numeric;
  /** Required for receipts; ignored for issues, which take the running average. */
  unitCost?: Numeric | null;
  /** 'YYYY-MM-DD'. Ordering is by date, then by `sequence`. */
  txnDate: string;
  /** Tie-break within one day — the database orders by created_at. */
  sequence?: number;
  isVoid?: boolean;
};

/** Movements that add to stock. TRANSFER is modelled as a pair of rows. */
const INBOUND: ReadonlySet<MovementType> = new Set(['IN', 'RETURN']);
const OUTBOUND: ReadonlySet<MovementType> = new Set(['OUT', 'TRANSFER']);

/**
 * Signed effect of a movement on the stock balance.
 *
 * ADJUSTMENT carries its own sign; everything else takes its direction from
 * the type, which is why `qty` is stored positive for those.
 */
export function signedQty(movement: InventoryMovement): Decimal {
  const qty = toDecimal(movement.qty);
  if (movement.txnType === 'ADJUSTMENT') return qty;
  if (OUTBOUND.has(movement.txnType)) return qty.abs().negated();
  return qty.abs();
}

export type LedgerEntry = {
  movement: InventoryMovement;
  /** Effect of this row on the balance. */
  qtyDelta: Decimal;
  balanceAfter: Decimal;
  /** Cost per unit attributed to this row. */
  unitCost: Decimal;
  /** Value moved by this row: qtyDelta x unitCost. */
  valueDelta: Decimal;
  averageCostAfter: Decimal;
  valueAfter: Decimal;
};

function ordered(movements: readonly InventoryMovement[]): InventoryMovement[] {
  return movements
    .filter((m) => m.isVoid !== true)
    .map((m, index) => ({ movement: m, index }))
    .sort((a, b) => {
      if (a.movement.txnDate !== b.movement.txnDate) {
        return a.movement.txnDate < b.movement.txnDate ? -1 : 1;
      }
      const seqA = a.movement.sequence ?? a.index;
      const seqB = b.movement.sequence ?? b.index;
      if (seqA !== seqB) return seqA - seqB;
      return a.index - b.index;
    })
    .map((entry) => entry.movement);
}

/**
 * Replays every movement in order, producing the running balance, average cost
 * and stock value after each one.
 *
 * The average only moves on an inbound row that carries a cost. An issue, a
 * transfer out or a quantity-only adjustment changes how much is on hand but
 * not what it is worth per unit.
 */
export function replayLedger(movements: readonly InventoryMovement[]): LedgerEntry[] {
  let balance = toDecimal(0);
  let average = toDecimal(0);
  let value = toDecimal(0);

  return ordered(movements).map((movement) => {
    const delta = signedQty(movement);
    const declaredCost = movement.unitCost === null || movement.unitCost === undefined
      ? null
      : toDecimal(movement.unitCost);

    let unitCost: Decimal;

    if (delta.isPositive() && declaredCost !== null) {
      // A receipt at a known price: this is the only thing that moves the
      // average.  newAvg = (prevQty x prevAvg + inQty x inPrice) / (prevQty + inQty)
      const newBalance = balance.plus(delta);
      const newValue = value.plus(delta.times(declaredCost));

      unitCost = declaredCost;
      balance = newBalance;
      value = newValue;
      // A balance back at zero has no meaningful average; keep the last known
      // price rather than dividing by zero.
      average = newBalance.isZero() ? declaredCost : newValue.dividedBy(newBalance);
    } else {
      // Everything else moves at the average in force right now.
      unitCost = declaredCost ?? average;
      balance = balance.plus(delta);
      value = value.plus(delta.times(unitCost));
      if (balance.isZero()) value = toDecimal(0);
    }

    return {
      movement,
      qtyDelta: delta,
      balanceAfter: balance,
      unitCost,
      valueDelta: delta.times(unitCost),
      averageCostAfter: average,
      valueAfter: value,
    };
  });
}

export type InventoryPosition = {
  qty: Decimal;
  averageCost: Decimal;
  value: Decimal;
  /** Total received, issued and adjusted, for the movement summary. */
  received: Decimal;
  issued: Decimal;
  adjusted: Decimal;
};

export function inventoryPosition(movements: readonly InventoryMovement[]): InventoryPosition {
  const ledger = replayLedger(movements);
  const last = ledger[ledger.length - 1];

  let received = toDecimal(0);
  let issued = toDecimal(0);
  let adjusted = toDecimal(0);

  for (const entry of ledger) {
    if (entry.movement.txnType === 'ADJUSTMENT') {
      adjusted = adjusted.plus(entry.qtyDelta);
    } else if (INBOUND.has(entry.movement.txnType)) {
      received = received.plus(entry.qtyDelta);
    } else {
      issued = issued.plus(entry.qtyDelta.abs());
    }
  }

  return {
    qty: last?.balanceAfter ?? toDecimal(0),
    averageCost: last?.averageCostAfter ?? toDecimal(0),
    value: last?.valueAfter ?? toDecimal(0),
    received,
    issued,
    adjusted,
  };
}

/** Stock value at the current moving average. */
export function stockValue(movements: readonly InventoryMovement[]): Decimal {
  return inventoryPosition(movements).value;
}

// ---------------------------------------------------------------------------
// Actual purchase prices and variance
// ---------------------------------------------------------------------------

export type PurchaseRecord = {
  qty: Numeric;
  unitPrice: Numeric;
  /** 'YYYY-MM-DD', used to find the most recent price. */
  purchaseDate: string;
};

export type PurchaseStatistics = {
  totalQty: Decimal;
  totalValue: Decimal;
  /** Weighted by quantity, not a plain mean of the prices. */
  averagePrice: Decimal | null;
  lastPrice: Decimal | null;
  minPrice: Decimal | null;
  maxPrice: Decimal | null;
  purchaseCount: number;
};

/**
 * Summary of what a resource has actually cost.
 *
 * The average is weighted by quantity: a 1 kg trial order at a bad price must
 * not drag the figure the same way a 10 tonne delivery does.
 */
export function purchaseStatistics(
  purchases: readonly PurchaseRecord[],
): PurchaseStatistics {
  if (purchases.length === 0) {
    return {
      totalQty: toDecimal(0),
      totalValue: toDecimal(0),
      averagePrice: null,
      lastPrice: null,
      minPrice: null,
      maxPrice: null,
      purchaseCount: 0,
    };
  }

  let totalQty = toDecimal(0);
  let totalValue = toDecimal(0);
  let min: Decimal | null = null;
  let max: Decimal | null = null;

  for (const purchase of purchases) {
    const qty = toDecimal(purchase.qty);
    const price = toDecimal(purchase.unitPrice);

    totalQty = totalQty.plus(qty);
    totalValue = totalValue.plus(qty.times(price));

    if (min === null || price.lessThan(min)) min = price;
    if (max === null || price.greaterThan(max)) max = price;
  }

  const latest = [...purchases].sort((a, b) =>
    a.purchaseDate === b.purchaseDate ? 0 : a.purchaseDate < b.purchaseDate ? -1 : 1,
  )[purchases.length - 1];

  return {
    totalQty,
    totalValue,
    averagePrice: safeDivide(totalValue, totalQty),
    lastPrice: latest ? toDecimal(latest.unitPrice) : null,
    minPrice: min,
    maxPrice: max,
    purchaseCount: purchases.length,
  };
}

export type PriceVariance = {
  /** actual − planned, per unit. Positive means it cost more than planned. */
  perUnit: Decimal | null;
  percent: Decimal | null;
  /** Total money effect across everything bought so far. */
  totalValue: Decimal | null;
};

/**
 * Actual purchase price against the planned price.
 *
 * Charter section 5.7: variance against RAP is the one that matters for cost
 * control; the same function serves RAB when the caller wants that comparison.
 */
export function priceVariance(
  statistics: PurchaseStatistics,
  plannedPrice: Numeric | null | undefined,
): PriceVariance {
  if (plannedPrice === null || plannedPrice === undefined || statistics.averagePrice === null) {
    return { perUnit: null, percent: null, totalValue: null };
  }

  const planned = toDecimal(plannedPrice);
  const perUnit = statistics.averagePrice.minus(planned);

  return {
    perUnit,
    // A planned price of zero makes the percentage meaningless, not infinite.
    percent: safeDivide(perUnit, planned),
    totalValue: statistics.totalValue.minus(statistics.totalQty.times(planned)),
  };
}
