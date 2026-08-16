import { toDecimal } from './decimal';

/**
 * The relationship between RAP, RAB and the markup that links them.
 *
 * Three fields, two degrees of freedom: RAP is what execution costs, and the
 * other two describe the same gap from opposite ends. Editing either one
 * derives the other, and RAP is never rewritten by them — a cost figure that
 * moved on its own because someone adjusted a margin would be a very quiet way
 * to lose money.
 *
 * Pure and string-based so the same rules drive the catalogue table, the price
 * dialog and the work-item form without three copies of the arithmetic.
 */

/** Parses a typed field, returning null for anything that is not yet a number. */
export function numericText(raw: unknown): string | null {
  const text = String(raw ?? '').trim();
  if (text === '') return null;
  return Number.isFinite(Number(text)) ? text : null;
}

/** RAB implied by a RAP and a markup percentage. */
export function rabFromMarkup(rapText: string, markupText: string): string {
  return toDecimal(rapText)
    .times(toDecimal(1).plus(toDecimal(markupText).dividedBy(100)))
    .toDecimalPlaces(2)
    .toString();
}

/**
 * Markup percentage implied by a RAP and a RAB.
 *
 * Null when RAP is zero: no percentage turns nothing into something, and
 * writing Infinity into the field is worse than leaving the old value alone.
 */
export function markupFromRab(rapText: string, rabText: string): string | null {
  const rap = toDecimal(rapText);
  if (rap.isZero()) return null;
  return toDecimal(rabText).dividedBy(rap).minus(1).times(100).toDecimalPlaces(2).toString();
}

export type PriceTriple = { rap: string; rab: string; markup: string };

/** Which field the user last drove, so a later RAP edit behaves predictably. */
export type PriceMode = 'markup' | 'rab';

/**
 * Applies one edit and returns the whole triple.
 *
 * Fields the edit cannot determine are returned unchanged rather than blanked:
 * a half-typed number must not wipe the neighbour the user already filled in.
 */
export function applyPriceEdit(
  current: PriceTriple,
  field: 'rap' | 'rab' | 'markup',
  value: string,
  mode: PriceMode,
): { next: PriceTriple; mode: PriceMode } {
  if (field === 'markup') {
    const rap = numericText(current.rap);
    const markup = numericText(value);
    const rab = rap !== null && markup !== null ? rabFromMarkup(rap, markup) : current.rab;
    return { next: { ...current, markup: value, rab }, mode: 'markup' };
  }

  if (field === 'rab') {
    const rap = numericText(current.rap);
    const rab = numericText(value);
    const markup = rap !== null && rab !== null ? markupFromRab(rap, rab) : null;
    return {
      next: { ...current, rab: value, markup: markup ?? current.markup },
      mode: 'rab',
    };
  }

  // RAP: authoritative. Update whichever of the other two is the consequence.
  const rap = numericText(value);
  if (rap === null) return { next: { ...current, rap: value }, mode };

  if (mode === 'markup') {
    const markup = numericText(current.markup);
    const rab = markup !== null ? rabFromMarkup(rap, markup) : current.rab;
    return { next: { ...current, rap: value, rab }, mode };
  }

  const rab = numericText(current.rab);
  const markup = rab !== null ? markupFromRab(rap, rab) : null;
  return { next: { ...current, rap: value, markup: markup ?? current.markup }, mode };
}
