import { describe, expect, it } from 'vitest';

import {
  inventoryPosition,
  priceVariance,
  purchaseStatistics,
  replayLedger,
  signedQty,
  stockValue,
  type InventoryMovement,
} from '../inventory';

const IN = (qty: string, unitCost: string, txnDate = '2026-03-01', sequence = 0) =>
  ({ txnType: 'IN', qty, unitCost, txnDate, sequence }) satisfies InventoryMovement;

const OUT = (qty: string, txnDate = '2026-03-02', sequence = 0) =>
  ({ txnType: 'OUT', qty, txnDate, sequence }) satisfies InventoryMovement;

describe('signedQty', () => {
  it('takes direction from the movement type', () => {
    expect(signedQty({ txnType: 'IN', qty: '100', txnDate: '2026-03-01' }).toString()).toBe('100');
    expect(signedQty({ txnType: 'OUT', qty: '40', txnDate: '2026-03-01' }).toString()).toBe('-40');
    expect(signedQty({ txnType: 'RETURN', qty: '5', txnDate: '2026-03-01' }).toString()).toBe('5');
    expect(signedQty({ txnType: 'TRANSFER', qty: '5', txnDate: '2026-03-01' }).toString()).toBe('-5');
  });

  // A stock count that finds less than the books claim has to be recordable.
  it('lets an adjustment carry its own sign', () => {
    expect(signedQty({ txnType: 'ADJUSTMENT', qty: '3', txnDate: '2026-03-01' }).toString()).toBe('3');
    expect(signedQty({ txnType: 'ADJUSTMENT', qty: '-3', txnDate: '2026-03-01' }).toString()).toBe('-3');
  });
});

describe('moving average — the worked example from the charter', () => {
  // Section 8: buy 100 @15.500 then 100 @16.200, average becomes 15.850.
  const movements = [IN('100', '15500', '2026-03-01', 0), IN('100', '16200', '2026-03-05', 1)];

  it('averages the two receipts by quantity', () => {
    const position = inventoryPosition(movements);
    expect(position.qty.toString()).toBe('200');
    expect(position.averageCost.toFixed(2)).toBe('15850.00');
    expect(position.value.toFixed(2)).toBe('3170000.00');
  });

  // Charter section 5.7: the first purchase is never rewritten.
  it('leaves the first receipt valued at its own price', () => {
    const ledger = replayLedger(movements);
    expect(ledger[0]?.unitCost.toFixed(2)).toBe('15500.00');
    expect(ledger[0]?.averageCostAfter.toFixed(2)).toBe('15500.00');
    expect(ledger[1]?.unitCost.toFixed(2)).toBe('16200.00');
  });

  it('values an issue at the average in force at that moment', () => {
    const ledger = replayLedger([
      IN('100', '15500', '2026-03-01', 0),
      OUT('50', '2026-03-02'),
      IN('100', '16200', '2026-03-05', 1),
    ]);

    // Issued before the second receipt, so it leaves at 15.500.
    expect(ledger[1]?.unitCost.toFixed(2)).toBe('15500.00');
    expect(ledger[1]?.balanceAfter.toString()).toBe('50');

    // 50 x 15.500 + 100 x 16.200 = 2.395.000 over 150 units.
    expect(ledger[2]?.averageCostAfter.toFixed(4)).toBe('15966.6667');
  });

  it('does not move the average on an issue', () => {
    const ledger = replayLedger([IN('100', '15500'), OUT('40')]);
    expect(ledger[1]?.averageCostAfter.toFixed(2)).toBe('15500.00');
    expect(ledger[1]?.balanceAfter.toString()).toBe('60');
    expect(ledger[1]?.valueAfter.toFixed(2)).toBe('930000.00');
  });
});

describe('replayLedger — ordering', () => {
  // The database orders by (txn_date, created_at); a back-dated correction has
  // to re-price everything after it, not append at the end.
  it('replays in date order regardless of input order', () => {
    const late = IN('100', '16200', '2026-03-05', 1);
    const early = IN('100', '15500', '2026-03-01', 0);

    const a = inventoryPosition([late, early]);
    const b = inventoryPosition([early, late]);

    expect(a.averageCost.toFixed(2)).toBe(b.averageCost.toFixed(2));
    expect(a.averageCost.toFixed(2)).toBe('15850.00');
  });

  it('breaks ties on the same date by sequence', () => {
    const ledger = replayLedger([
      IN('100', '16200', '2026-03-01', 2),
      IN('100', '15500', '2026-03-01', 1),
    ]);
    expect(ledger[0]?.unitCost.toFixed(2)).toBe('15500.00');
  });

  it('ignores voided movements entirely', () => {
    const position = inventoryPosition([
      IN('100', '15500'),
      { ...IN('999', '99999', '2026-03-02'), isVoid: true },
    ]);
    expect(position.qty.toString()).toBe('100');
    expect(position.averageCost.toFixed(2)).toBe('15500.00');
  });

  it('handles an empty ledger', () => {
    const position = inventoryPosition([]);
    expect(position.qty.toString()).toBe('0');
    expect(position.averageCost.toString()).toBe('0');
    expect(stockValue([])).toEqual(position.value);
  });
});

describe('replayLedger — edge cases', () => {
  it('keeps the last known price when stock returns to zero', () => {
    const ledger = replayLedger([IN('100', '15500'), OUT('100')]);
    expect(ledger[1]?.balanceAfter.toString()).toBe('0');
    expect(ledger[1]?.valueAfter.toString()).toBe('0');
    // Value is zero, but the price is remembered for the next receipt.
    expect(ledger[1]?.averageCostAfter.toFixed(2)).toBe('15500.00');
  });

  it('applies a negative adjustment at the running average', () => {
    const ledger = replayLedger([
      IN('100', '15500'),
      { txnType: 'ADJUSTMENT', qty: '-10', txnDate: '2026-03-03' },
    ]);
    expect(ledger[1]?.balanceAfter.toString()).toBe('90');
    expect(ledger[1]?.valueAfter.toFixed(2)).toBe('1395000.00');
    expect(ledger[1]?.averageCostAfter.toFixed(2)).toBe('15500.00');
  });

  it('treats a receipt without a price as a quantity-only movement', () => {
    const ledger = replayLedger([IN('100', '15500'), { txnType: 'IN', qty: '50', txnDate: '2026-03-04' }]);
    expect(ledger[1]?.balanceAfter.toString()).toBe('150');
    // Priced at the running average rather than dragging it to zero.
    expect(ledger[1]?.averageCostAfter.toFixed(2)).toBe('15500.00');
  });

  it('summarises received, issued and adjusted separately', () => {
    const position = inventoryPosition([
      IN('100', '15500'),
      OUT('30'),
      { txnType: 'RETURN', qty: '5', txnDate: '2026-03-03' },
      { txnType: 'ADJUSTMENT', qty: '-2', txnDate: '2026-03-04' },
    ]);
    expect(position.received.toString()).toBe('105');
    expect(position.issued.toString()).toBe('30');
    expect(position.adjusted.toString()).toBe('-2');
    expect(position.qty.toString()).toBe('73');
  });
});

describe('purchaseStatistics', () => {
  const purchases = [
    { qty: '100', unitPrice: '15500', purchaseDate: '2026-03-01' },
    { qty: '100', unitPrice: '16200', purchaseDate: '2026-03-05' },
  ];

  it('reports the quantity-weighted average and the extremes', () => {
    const stats = purchaseStatistics(purchases);
    expect(stats.averagePrice?.toFixed(2)).toBe('15850.00');
    expect(stats.minPrice?.toString()).toBe('15500');
    expect(stats.maxPrice?.toString()).toBe('16200');
    expect(stats.lastPrice?.toString()).toBe('16200');
    expect(stats.totalQty.toString()).toBe('200');
    expect(stats.purchaseCount).toBe(2);
  });

  // A one-unit trial order must not shift the average like a bulk delivery.
  it('weights by quantity rather than averaging the prices', () => {
    const stats = purchaseStatistics([
      { qty: '1000', unitPrice: '15000', purchaseDate: '2026-03-01' },
      { qty: '1', unitPrice: '90000', purchaseDate: '2026-03-02' },
    ]);
    // A plain mean would be 52.500; weighted it is barely above 15.000.
    expect(stats.averagePrice?.toFixed(2)).toBe('15074.93');
  });

  it('returns nulls for a resource never purchased', () => {
    const stats = purchaseStatistics([]);
    expect(stats.averagePrice).toBeNull();
    expect(stats.lastPrice).toBeNull();
    expect(stats.purchaseCount).toBe(0);
  });
});

describe('priceVariance', () => {
  // Charter section 8: average 15.850 against RAP 15.500 is +350 (+2,26%).
  it('reports the charter example exactly', () => {
    const stats = purchaseStatistics([
      { qty: '100', unitPrice: '15500', purchaseDate: '2026-03-01' },
      { qty: '100', unitPrice: '16200', purchaseDate: '2026-03-05' },
    ]);
    const variance = priceVariance(stats, '15500');

    expect(variance.perUnit?.toFixed(2)).toBe('350.00');
    expect(variance.percent?.times(100).toFixed(2)).toBe('2.26');
    // 200 units bought 350 above plan.
    expect(variance.totalValue?.toFixed(2)).toBe('70000.00');
  });

  it('reports a favourable variance as negative', () => {
    const stats = purchaseStatistics([{ qty: '10', unitPrice: '14000', purchaseDate: '2026-03-01' }]);
    const variance = priceVariance(stats, '15500');
    expect(variance.perUnit?.toFixed(2)).toBe('-1500.00');
    expect(variance.totalValue?.toFixed(2)).toBe('-15000.00');
  });

  it('returns nulls rather than dividing by a planned price of zero', () => {
    const stats = purchaseStatistics([{ qty: '10', unitPrice: '14000', purchaseDate: '2026-03-01' }]);
    expect(priceVariance(stats, '0').percent).toBeNull();
    expect(priceVariance(stats, null).perUnit).toBeNull();
    expect(priceVariance(purchaseStatistics([]), '15500').perUnit).toBeNull();
  });
});
