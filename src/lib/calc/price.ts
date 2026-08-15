/**
 * Price-book resolution rule — charter section 4.2.
 *
 * Kept pure and separate from the query that fetches candidates, because this
 * is the rule that decides which number every downstream calculation uses. A
 * mistake here is invisible: the estimate still produces a total, just the
 * wrong one.
 *
 * The rule, in order:
 *   1. the project's own override, effective on or before the date
 *   2. failing that, the organisation default, effective on or before the date
 *   3. failing that, nothing — and the caller reports which resource and which
 *      price type is missing
 *
 * Actual purchase prices never take part. They live on `purchase_items`.
 */

export type PriceType = 'RAB' | 'RAP';

export type PriceCandidate = {
  /** Money as an exact decimal string, straight from `numeric`. */
  price: string;
  /** 'YYYY-MM-DD'. Lexicographic order is chronological order. */
  effectiveFrom: string;
  /** null marks the organisation-wide default. */
  projectId: string | null;
  priceType: PriceType;
  /** Only used to break a tie deterministically. */
  id?: string;
};

export type PriceSelection = {
  projectId: string | null;
  priceType: PriceType;
  /** Date the resolution was made for. */
  onDate: string;
};

/**
 * Picks the newest candidate that is already in force.
 *
 * A price dated in the future is not yet in force and is ignored: an agreed
 * price increase entered in advance must not silently re-price work that was
 * estimated before it.
 */
export function selectEffectivePrice(
  candidates: readonly PriceCandidate[],
  selection: PriceSelection,
): PriceCandidate | null {
  const { projectId, priceType, onDate } = selection;

  const inForce = candidates.filter(
    (c) => c.priceType === priceType && c.effectiveFrom <= onDate,
  );

  if (projectId !== null) {
    const scoped = pickNewest(inForce.filter((c) => c.projectId === projectId));
    if (scoped) return scoped;
  }

  return pickNewest(inForce.filter((c) => c.projectId === null));
}

function pickNewest(candidates: readonly PriceCandidate[]): PriceCandidate | null {
  let best: PriceCandidate | null = null;

  for (const candidate of candidates) {
    if (best === null) {
      best = candidate;
      continue;
    }
    if (candidate.effectiveFrom > best.effectiveFrom) {
      best = candidate;
      continue;
    }
    // Same date: a database unique index makes this unreachable in practice,
    // but resolution must still be deterministic rather than input-order
    // dependent.
    if (candidate.effectiveFrom === best.effectiveFrom) {
      const a = candidate.id ?? '';
      const b = best.id ?? '';
      if (a > b) best = candidate;
    }
  }

  return best;
}

/**
 * Where a resolved price came from. Shown in the AHSP editor so a surprising
 * unit rate can be traced to its row in the price book without guesswork.
 */
export type PriceOrigin = 'PROJECT_OVERRIDE' | 'ORGANISATION_DEFAULT';

export function priceOrigin(candidate: PriceCandidate): PriceOrigin {
  return candidate.projectId === null ? 'ORGANISATION_DEFAULT' : 'PROJECT_OVERRIDE';
}

export const PRICE_ORIGIN_LABELS: Record<PriceOrigin, string> = {
  PROJECT_OVERRIDE: 'Harga khusus proyek',
  ORGANISATION_DEFAULT: 'Harga default organisasi',
};

export const PRICE_TYPE_LABELS: Record<PriceType, string> = {
  RAB: 'RAB',
  RAP: 'RAP',
};
