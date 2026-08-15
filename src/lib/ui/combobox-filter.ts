/**
 * Matching rule behind the searchable dropdown.
 *
 * Kept out of the component so it can be tested directly: with 379 resources
 * in the catalogue, whether "besi 12" finds the right row is the part that
 * decides if the control is usable, and it is not something a screenshot can
 * confirm.
 */

export type FilterableOption = {
  value: string;
  label: string;
  code?: string;
  description?: string;
  meta?: string;
};

/** Everything a row can be found by, lower-cased and joined. */
export function haystackOf(option: FilterableOption): string {
  return [option.code, option.label, option.description, option.meta]
    .filter((part): part is string => Boolean(part))
    .join(' ')
    .toLowerCase();
}

/** Splits a query into independent search terms. */
export function termsOf(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * True when every term appears somewhere in the haystack.
 *
 * Terms are ANDed and matched independently of order, so "12 besi" and
 * "besi 12" behave the same — a user recalling a spec rarely recalls the
 * order it was written in.
 */
export function matches(haystack: string, terms: readonly string[]): boolean {
  return terms.every((term) => haystack.includes(term));
}

/** Pre-computed index, built once per option list rather than per keystroke. */
export type IndexedOption<T extends FilterableOption> = { option: T; haystack: string };

export function indexOptions<T extends FilterableOption>(
  options: readonly T[],
): IndexedOption<T>[] {
  return options.map((option) => ({ option, haystack: haystackOf(option) }));
}

export function filterIndexed<T extends FilterableOption>(
  indexed: readonly IndexedOption<T>[],
  query: string,
): T[] {
  const terms = termsOf(query);
  if (terms.length === 0) return indexed.map((entry) => entry.option);
  return indexed.filter((entry) => matches(entry.haystack, terms)).map((entry) => entry.option);
}

/**
 * The rows actually rendered: the first `max` matches, but never without the
 * current selection.
 *
 * A catalogue of 379 easily pushes the chosen row past the cap, and a panel
 * that opens with no tick anywhere reads as though nothing was ever chosen.
 * When the selection does not match the query it stays hidden — the query is
 * the user's own instruction, and answering it honestly matters more.
 */
export function visibleWithSelection<T extends FilterableOption>(
  filtered: readonly T[],
  max: number,
  value: string,
): T[] {
  const head = filtered.slice(0, max);
  if (value === '' || head.some((option) => option.value === value)) return head;

  const chosen = filtered.find((option) => option.value === value);
  return chosen ? [chosen, ...head.slice(0, Math.max(max - 1, 0))] : head;
}
