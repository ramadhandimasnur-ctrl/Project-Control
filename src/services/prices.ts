import 'server-only';

import { and, asc, desc, eq, inArray, isNull, lte, or } from 'drizzle-orm';

import { db, type DbExecutor } from '@/db';
import { withUser } from '@/db/context';
import { resourcePrices, resources, units } from '@/db/schema';
import { type Decimal, toDecimal } from '@/lib/calc/decimal';
import {
  priceOrigin,
  selectEffectivePrice,
  type PriceCandidate,
  type PriceOrigin,
  type PriceType,
} from '@/lib/calc/price';
import { AppError, notFound } from '@/lib/errors';

import { assertOrgAccess } from './org-access';
import { assertProjectAccess } from './access';
import { writeAuditLog } from './audit';
import { type SessionUser } from './session';

export type ResolvedPrice = {
  resourceId: string;
  price: Decimal;
  effectiveFrom: string;
  origin: PriceOrigin;
};

export type MissingPrice = {
  resourceId: string;
  code: string;
  name: string;
  priceType: PriceType;
};

/** Loads every candidate for a set of resources in one round trip. */
async function loadCandidates(
  executor: DbExecutor,
  resourceIds: readonly string[],
  projectId: string | null,
  priceType: PriceType,
  onDate: string,
): Promise<Map<string, PriceCandidate[]>> {
  if (resourceIds.length === 0) return new Map();

  const rows = await executor
    .select({
      id: resourcePrices.id,
      resourceId: resourcePrices.resourceId,
      projectId: resourcePrices.projectId,
      priceType: resourcePrices.priceType,
      price: resourcePrices.price,
      effectiveFrom: resourcePrices.effectiveFrom,
    })
    .from(resourcePrices)
    .where(
      and(
        inArray(resourcePrices.resourceId, [...resourceIds]),
        eq(resourcePrices.priceType, priceType),
        lte(resourcePrices.effectiveFrom, onDate),
        // Only the two scopes that can apply: this project, or the default.
        projectId === null
          ? isNull(resourcePrices.projectId)
          : or(isNull(resourcePrices.projectId), eq(resourcePrices.projectId, projectId)),
      ),
    );

  const byResource = new Map<string, PriceCandidate[]>();
  for (const row of rows) {
    const list = byResource.get(row.resourceId) ?? [];
    list.push({
      id: row.id,
      price: row.price,
      effectiveFrom: row.effectiveFrom,
      projectId: row.projectId,
      priceType: row.priceType,
    });
    byResource.set(row.resourceId, list);
  }
  return byResource;
}

/**
 * The single price-resolution entry point named by charter section 4.2.
 *
 * Internal: it performs no authorisation of its own and is always called from
 * a service that has already run `assertProjectAccess` or `assertOrgAccess`.
 * Never call it straight from a route handler.
 *
 * Throws MISSING_PRICE, naming the resource and the price type, so the user is
 * told what to fill in and where — not handed "harga tidak ditemukan".
 */
export async function resolvePrice(
  resourceId: string,
  projectId: string | null,
  priceType: PriceType,
  onDate: string,
  executor: DbExecutor = db,
): Promise<ResolvedPrice> {
  const { resolved, missing } = await resolvePriceMap(
    [resourceId],
    projectId,
    priceType,
    onDate,
    executor,
  );

  const hit = resolved.get(resourceId);
  if (hit) return hit;

  const gap = missing[0];
  throw missingPriceError(gap, priceType);
}

/**
 * Batch resolution.
 *
 * Returns what it found *and* what it could not find, rather than throwing on
 * the first gap: an AHSP with eight unpriced resources should report all eight
 * at once, not force the user to fix them one reload at a time.
 */
export async function resolvePriceMap(
  resourceIds: readonly string[],
  projectId: string | null,
  priceType: PriceType,
  onDate: string,
  executor: DbExecutor = db,
): Promise<{ resolved: Map<string, ResolvedPrice>; missing: MissingPrice[] }> {
  const unique = [...new Set(resourceIds)];
  const candidates = await loadCandidates(executor, unique, projectId, priceType, onDate);

  const resolved = new Map<string, ResolvedPrice>();
  const unresolved: string[] = [];

  for (const resourceId of unique) {
    const chosen = selectEffectivePrice(candidates.get(resourceId) ?? [], {
      projectId,
      priceType,
      onDate,
    });

    if (!chosen) {
      unresolved.push(resourceId);
      continue;
    }

    resolved.set(resourceId, {
      resourceId,
      price: toDecimal(chosen.price),
      effectiveFrom: chosen.effectiveFrom,
      origin: priceOrigin(chosen),
    });
  }

  if (unresolved.length === 0) return { resolved, missing: [] };

  // Names are fetched only for the gaps, so the error can be specific.
  const named = await executor
    .select({ id: resources.id, code: resources.code, name: resources.name })
    .from(resources)
    .where(inArray(resources.id, unresolved));

  const byId = new Map(named.map((r) => [r.id, r]));
  const missing: MissingPrice[] = unresolved.map((id) => ({
    resourceId: id,
    code: byId.get(id)?.code ?? '(tidak dikenal)',
    name: byId.get(id)?.name ?? '(sumber daya tidak ditemukan)',
    priceType,
  }));

  return { resolved, missing };
}

/** Charter rule 12: say what is missing and where to add it. */
export function missingPriceError(gap: MissingPrice | undefined, priceType: PriceType): AppError {
  if (!gap) {
    return new AppError('MISSING_PRICE', 'Sumber daya tidak ditemukan.');
  }
  return new AppError(
    'MISSING_PRICE',
    `Harga ${priceType} untuk "${gap.name}" (${gap.code}) belum diisi.`,
    'Tambahkan di Master Data → Daftar Harga.',
  );
}

// ---------------------------------------------------------------------------
// Price book maintenance
// ---------------------------------------------------------------------------

export type PriceHistoryRow = {
  id: string;
  priceType: PriceType;
  price: string;
  effectiveFrom: string;
  projectId: string | null;
  source: string | null;
  note: string | null;
};

/**
 * Full history for one resource, newest first.
 *
 * Charter section 5.7: a price is never overwritten. Every change is a new row
 * with its own effective date, so an old estimate can always be explained.
 */
export async function listPriceHistory(
  userId: string,
  resourceId: string,
  projectId: string | null = null,
): Promise<PriceHistoryRow[]> {
  await assertOrgAccess(userId);
  if (projectId !== null) await assertProjectAccess(userId, projectId, 'VIEWER');

  return withUser(userId, (tx) =>
    tx
      .select({
        id: resourcePrices.id,
        priceType: resourcePrices.priceType,
        price: resourcePrices.price,
        effectiveFrom: resourcePrices.effectiveFrom,
        projectId: resourcePrices.projectId,
        source: resourcePrices.source,
        note: resourcePrices.note,
      })
      .from(resourcePrices)
      .where(
        and(
          eq(resourcePrices.resourceId, resourceId),
          projectId === null
            ? isNull(resourcePrices.projectId)
            : or(isNull(resourcePrices.projectId), eq(resourcePrices.projectId, projectId)),
        ),
      )
      .orderBy(desc(resourcePrices.effectiveFrom), asc(resourcePrices.priceType)),
  );
}

export type SetPriceInput = {
  resourceId: string;
  /** null writes the organisation default. */
  projectId: string | null;
  priceType: PriceType;
  price: string;
  effectiveFrom: string;
  source?: string | null;
  note?: string | null;
};

/**
 * Adds a price to the book.
 *
 * Organisation defaults are ADMIN territory; a project override only needs
 * ENGINEER on that project, because negotiating a project-specific rate is
 * part of building its estimate.
 */
export async function setPrice(user: SessionUser, input: SetPriceInput): Promise<void> {
  const access =
    input.projectId === null
      ? await assertOrgAccess(user.id, 'ADMIN')
      : await assertProjectAccess(user.id, input.projectId, 'ENGINEER');

  const [resource] = await db
    .select({ id: resources.id, orgId: resources.orgId, name: resources.name })
    .from(resources)
    .where(eq(resources.id, input.resourceId))
    .limit(1);

  if (!resource || resource.orgId !== access.orgId) {
    throw notFound('Sumber daya tidak ditemukan di organisasi ini.');
  }

  await withUser(user.id, async (tx) => {
    // Re-entering the same effective date replaces that row rather than
    // colliding with the unique index; the history keeps one entry per date.
    await tx
      .delete(resourcePrices)
      .where(
        and(
          eq(resourcePrices.resourceId, input.resourceId),
          eq(resourcePrices.priceType, input.priceType),
          eq(resourcePrices.effectiveFrom, input.effectiveFrom),
          input.projectId === null
            ? isNull(resourcePrices.projectId)
            : eq(resourcePrices.projectId, input.projectId),
        ),
      );

    await tx.insert(resourcePrices).values({
      resourceId: input.resourceId,
      projectId: input.projectId,
      priceType: input.priceType,
      price: input.price,
      effectiveFrom: input.effectiveFrom,
      source: input.source ?? null,
      note: input.note ?? null,
      createdBy: user.id,
      updatedBy: user.id,
    });

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId: input.projectId,
      tableName: 'resource_prices',
      recordId: input.resourceId,
      action: 'INSERT',
      after: input,
      actorId: user.id,
    });
  });
}

/** Units are needed alongside prices whenever a resource is displayed. */
export async function listUnitsForOrg(userId: string) {
  const access = await assertOrgAccess(userId);
  return db
    .select({ id: units.id, code: units.code, name: units.name, dimension: units.dimension })
    .from(units)
    .where(eq(units.orgId, access.orgId))
    .orderBy(asc(units.code));
}
