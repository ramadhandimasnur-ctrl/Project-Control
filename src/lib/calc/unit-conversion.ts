import { type Decimal, safeDivide, toDecimal, type Numeric } from './decimal';

/**
 * Unit conversion — charter rule 8.
 *
 * Conversion happens only inside one dimension, and a cross-dimension request
 * is refused rather than approximated. Silently turning 50 sacks into 50 m³ is
 * the kind of error that survives all the way to a purchase order.
 *
 * Every unit carries `factorToBase`: how many base units one of it represents.
 * Converting is therefore a ratio, with no conversion table to maintain.
 */

export type ConvertibleUnit = {
  code: string;
  dimension: string;
  /** How many base units one of this unit equals. Must be positive. */
  factorToBase: Numeric;
};

export type ConversionResult =
  | { ok: true; value: Decimal; converted: boolean }
  | { ok: false; message: string; hint?: string };

/**
 * Converts a quantity from one unit to another.
 *
 * Returns a result rather than throwing: the caller is usually validating a
 * form and wants to report the problem next to the field.
 */
export function convertQuantity(
  qty: Numeric,
  from: ConvertibleUnit,
  to: ConvertibleUnit,
): ConversionResult {
  if (from.code === to.code) {
    return { ok: true, value: toDecimal(qty), converted: false };
  }

  if (from.dimension !== to.dimension) {
    return {
      ok: false,
      message: `Satuan "${from.code}" dan "${to.code}" mengukur hal yang berbeda, sehingga tidak dapat dikonversi.`,
      hint: 'Konversi hanya berlaku dalam dimensi yang sama, misalnya kg ke ton.',
    };
  }

  const fromFactor = toDecimal(from.factorToBase);
  const toFactor = toDecimal(to.factorToBase);

  // decimal.js reports zero as positive, so the comparison has to be explicit.
  if (fromFactor.lessThanOrEqualTo(0) || toFactor.lessThanOrEqualTo(0)) {
    return {
      ok: false,
      message: `Faktor konversi untuk "${from.code}" atau "${to.code}" tidak valid.`,
      hint: 'Perbaiki faktor satuan di Master Data → Satuan.',
    };
  }

  // qty in base units, then expressed in the target unit.
  const inBase = toDecimal(qty).times(fromFactor);
  const value = safeDivide(inBase, toFactor);

  if (value === null) {
    return { ok: false, message: `Faktor konversi "${to.code}" bernilai nol.` };
  }

  return { ok: true, value, converted: true };
}

/** True when the two units can be converted between at all. */
export function isConvertible(from: ConvertibleUnit, to: ConvertibleUnit): boolean {
  return from.dimension === to.dimension;
}
