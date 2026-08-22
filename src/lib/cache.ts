import { unstable_cache } from 'next/cache';

/**
 * Cross-request caching for the catalogue lists.
 *
 * Units, categories and suppliers change a few times a year, and every project
 * page that offers a dropdown reads them again. `cache()` from React only
 * deduplicates within a single request, which does nothing for the case that
 * hurts: the same list fetched afresh on every navigation.
 *
 * Only lists with no money in them are cached here. Prices and quantities are
 * deliberately left uncached — a stale figure that looks authoritative is worse
 * than a slow one, and the whole point of this application is that every number
 * on screen can be traced.
 */
export const MASTER_DATA_TAG = 'master-data';

/**
 * Caches per organisation, invalidates for everyone.
 *
 * The key carries the organisation id, so no tenant can ever read another's
 * rows out of the cache. The tag does not: one shared tag means a catalogue
 * edit in one organisation drops another's cached list too, which costs that
 * organisation a single re-query and removes any chance of a missed
 * invalidation. Correctness is worth one query.
 */
export function cachedByOrg<T>(name: string, orgId: string, load: () => Promise<T>): Promise<T> {
  /*
   * Outside the Next.js server there is nothing to cache into, and
   * `unstable_cache` throws an invariant rather than degrading to a plain
   * call. The same service functions are used by the seed script, the UTBA
   * importer and the integration tests, and none of those should have to know
   * that a list happens to be cached in production. `NEXT_RUNTIME` is set by
   * the server and by nothing else.
   */
  if (!process.env.NEXT_RUNTIME) return load();

  return unstable_cache(load, [name, orgId], { tags: [MASTER_DATA_TAG] })();
}
