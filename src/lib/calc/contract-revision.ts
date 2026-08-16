import { type Decimal, safeDivide, toDecimal, type Numeric } from './decimal';

/**
 * Change-order arithmetic — pekerjaan tambah/kurang.
 *
 * A revision is a set of volume changes. Everything else about it — the value
 * it adds or removes, the weight each item ends up carrying, the new contract
 * total — follows from those volumes and the unit values already established
 * by the estimate. Nothing here reads a stored total, because a stored total is
 * a figure that can disagree with the lines it claims to sum.
 */

export type RevisionLineInput = {
  workItemId: string;
  code: string;
  name: string;
  unitCode: string;
  /** Volume before this revision — as recorded when the line was drafted. */
  volumeBefore: Numeric;
  volumeAfter: Numeric;
  /** Contract value of one unit, from the estimate. */
  unitValue: Numeric;
  /** False for operational lines: costed, but outside the progress weight. */
  includeInProgressWeight: boolean;
};

export type RevisionLineResult = {
  workItemId: string;
  code: string;
  name: string;
  unitCode: string;
  volumeBefore: Decimal;
  volumeAfter: Decimal;
  volumeDelta: Decimal;
  unitValue: Decimal;
  valueBefore: Decimal;
  valueAfter: Decimal;
  valueDelta: Decimal;
  /** ADD when it starts from nothing, REMOVE when it ends at nothing. */
  kind: 'ADD' | 'CHANGE' | 'REMOVE';
};

export type RevisionSummary = {
  lines: RevisionLineResult[];
  /** Σ of the positive value changes — pekerjaan tambah. */
  addedValue: Decimal;
  /** Σ of the negative value changes, reported positive — pekerjaan kurang. */
  removedValue: Decimal;
  /** addedValue − removedValue. */
  netValue: Decimal;
  contractValueBefore: Decimal;
  contractValueAfter: Decimal;
  /** Null when there was no contract value to measure the change against. */
  netPercent: Decimal | null;
};

function kindOf(before: Decimal, after: Decimal): RevisionLineResult['kind'] {
  if (before.isZero() && !after.isZero()) return 'ADD';
  if (!before.isZero() && after.isZero()) return 'REMOVE';
  return 'CHANGE';
}

/**
 * What a revision does to the contract.
 *
 * `contractValueBefore` is the whole project's value as it stands, not just
 * the lines this revision touches: an addendum is measured against the
 * contract, not against its own extract.
 */
export function summariseRevision(
  lines: readonly RevisionLineInput[],
  contractValueBefore: Numeric,
): RevisionSummary {
  const results: RevisionLineResult[] = lines.map((line) => {
    const before = toDecimal(line.volumeBefore);
    const after = toDecimal(line.volumeAfter);
    const unitValue = toDecimal(line.unitValue);
    const valueBefore = before.times(unitValue);
    const valueAfter = after.times(unitValue);

    return {
      workItemId: line.workItemId,
      code: line.code,
      name: line.name,
      unitCode: line.unitCode,
      volumeBefore: before,
      volumeAfter: after,
      volumeDelta: after.minus(before),
      unitValue,
      valueBefore,
      valueAfter,
      valueDelta: valueAfter.minus(valueBefore),
      kind: kindOf(before, after),
    };
  });

  const addedValue = results.reduce<Decimal>(
    (acc, line) => (line.valueDelta.isPositive() ? acc.plus(line.valueDelta) : acc),
    toDecimal(0),
  );
  const removedValue = results.reduce<Decimal>(
    (acc, line) => (line.valueDelta.isNegative() ? acc.plus(line.valueDelta.abs()) : acc),
    toDecimal(0),
  );

  const netValue = addedValue.minus(removedValue);
  const before = toDecimal(contractValueBefore);

  return {
    lines: results,
    addedValue,
    removedValue,
    netValue,
    contractValueBefore: before,
    contractValueAfter: before.plus(netValue),
    netPercent: safeDivide(netValue, before),
  };
}

export type ScopeComparisonInput = {
  workItemId: string | null;
  code: string;
  name: string;
  unitCode: string;
  /** From Baseline 0. */
  baselineVolume: Numeric;
  baselineValue: Numeric;
  baselineWeight: Numeric;
  /** As things stand now, after every approved revision. */
  currentVolume: Numeric;
  currentValue: Numeric;
  currentWeight: Numeric;
};

export type ScopeComparisonRow = ScopeComparisonInput & {
  volumeDelta: Decimal;
  valueDelta: Decimal;
  weightDelta: Decimal;
};

export type ScopeComparison = {
  rows: ScopeComparisonRow[];
  totals: {
    baselineValue: Decimal;
    currentValue: Decimal;
    valueDelta: Decimal;
    /** Null when the baseline carried no value to compare against. */
    valuePercent: Decimal | null;
  };
};

/**
 * Baseline 0 against where the scope stands now.
 *
 * The printed addendum's central table. Items present in only one of the two
 * still appear, with zero on the side they are absent from — an item added by
 * a revision has no baseline volume, and one removed entirely has no current
 * one, and dropping either would make the columns stop adding up.
 */
export function compareScope(rows: readonly ScopeComparisonInput[]): ScopeComparison {
  const compared: ScopeComparisonRow[] = rows.map((row) => ({
    ...row,
    volumeDelta: toDecimal(row.currentVolume).minus(toDecimal(row.baselineVolume)),
    valueDelta: toDecimal(row.currentValue).minus(toDecimal(row.baselineValue)),
    weightDelta: toDecimal(row.currentWeight).minus(toDecimal(row.baselineWeight)),
  }));

  const baselineValue = compared.reduce<Decimal>(
    (acc, row) => acc.plus(toDecimal(row.baselineValue)),
    toDecimal(0),
  );
  const currentValue = compared.reduce<Decimal>(
    (acc, row) => acc.plus(toDecimal(row.currentValue)),
    toDecimal(0),
  );
  const valueDelta = currentValue.minus(baselineValue);

  return {
    rows: compared,
    totals: {
      baselineValue,
      currentValue,
      valueDelta,
      valuePercent: safeDivide(valueDelta, baselineValue),
    },
  };
}
