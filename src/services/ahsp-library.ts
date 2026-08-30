import { and, asc, count, eq, ilike, inArray, or, sql } from 'drizzle-orm';

import { db } from '@/db';
import { withUser } from '@/db/context';
import { ahspLibraryEntries, ahspLibraryItems, resources, workItemResources } from '@/db/schema';
import { conflict, notFound } from '@/lib/errors';
import { type LibraryEntry } from '@/lib/import/ahsp-library';

import { assertProjectAccess } from './access';
import { writeAuditLog } from './audit';
import { assertOrgAccess } from './org-access';
import { type SessionUser } from './session';

/**
 * The published AHSP library: reading it, importing it, applying an entry.
 *
 * Nothing here writes prices. The library's authority covers coefficients and
 * nothing else — see `db/schema/ahsp-library.ts` for why.
 */

export type LibraryEntryRow = {
  id: string;
  code: string;
  name: string;
  unitCode: string;
  sourceName: string | null;
  sourceYear: number | null;
  lineCount: number;
};

export type LibraryImportSummary = {
  batch: string;
  entriesCreated: number;
  entriesUpdated: number;
  itemsWritten: number;
};

/*
 * Written in chunks, not row by row.
 *
 * A full national library is 2.801 analyses and 16.136 lines. One statement
 * per line is 16.136 round trips, which against a hosted database is the
 * difference between a minute and an afternoon.
 */
const CHUNK = 500;

async function insertChunked<T>(rows: T[], write: (slice: T[]) => Promise<unknown>): Promise<number> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await write(rows.slice(i, i + CHUNK));
  }
  return rows.length;
}

/**
 * Replaces the library with what the file says, entry by entry.
 *
 * Idempotent, for the same reason the UTBA importer is: re-importing a
 * corrected file is the normal way to work. An entry that already exists has
 * its lines replaced wholesale rather than merged — a coefficient removed from
 * the source has to disappear here too, and merging would keep it for ever.
 */
export async function importAhspLibrary(
  user: SessionUser,
  entries: LibraryEntry[],
  batch: string,
): Promise<LibraryImportSummary> {
  const access = await assertOrgAccess(user.id, 'ADMIN');

  return withUser(user.id, async (tx) => {
    const existing = await tx
      .select({ id: ahspLibraryEntries.id, code: ahspLibraryEntries.code })
      .from(ahspLibraryEntries)
      .where(eq(ahspLibraryEntries.orgId, access.orgId));

    const idByCode = new Map(existing.map((row) => [row.code, row.id]));

    const fresh = entries.filter((e) => !idByCode.has(e.code));
    const known = entries.filter((e) => idByCode.has(e.code));

    const header = (entry: LibraryEntry) => ({
      name: entry.name,
      unitCode: entry.unitCode,
      sourceName: entry.sourceName,
      sourceYear: entry.sourceYear,
      sourceDocument: entry.sourceDocument,
      sourceSheet: entry.sourceSheet,
      sourceRow: entry.sourceRow,
      sourceUrl: entry.sourceUrl,
      importBatch: batch,
      isActive: true,
      updatedBy: user.id,
    });

    /*
     * New entries go in together.
     *
     * A first import is 2.801 of them, and one INSERT each is 2.801 round
     * trips — four minutes against a database in another region, for work the
     * server can do in seconds. `returning` hands back the ids in the order
     * they were sent, which is how each entry finds its own lines again.
     */
    for (let i = 0; i < fresh.length; i += CHUNK) {
      const slice = fresh.slice(i, i + CHUNK);
      const inserted = await tx
        .insert(ahspLibraryEntries)
        .values(
          slice.map((entry) => ({
            ...header(entry),
            orgId: access.orgId,
            code: entry.code,
            createdBy: user.id,
          })),
        )
        .returning({ id: ahspLibraryEntries.id, code: ahspLibraryEntries.code });

      for (const row of inserted) idByCode.set(row.code, row.id);
    }

    /*
     * Existing entries are still updated one at a time. A re-import is the
     * uncommon path, and batching an UPDATE means either a VALUES join or a
     * delete-and-reinsert that would take the entry id with it — and the id is
     * what anything referring to this analysis holds on to.
     */
    for (const entry of known) {
      const id = idByCode.get(entry.code);
      if (id === undefined) continue;
      await tx.update(ahspLibraryEntries).set(header(entry)).where(eq(ahspLibraryEntries.id, id));
      await tx.delete(ahspLibraryItems).where(eq(ahspLibraryItems.entryId, id));
    }

    // One flat list of lines, so the whole library is written in a few
    // statements rather than a few per analysis.
    const allItems = entries.flatMap((entry) => {
      const parentId = idByCode.get(entry.code);
      if (parentId === undefined) return [];
      return entry.items.map((item) => ({
        entryId: parentId,
        role: item.role,
        resourceCode: item.resourceCode,
        resourceName: item.resourceName,
        unitCode: item.unitCode,
        coef: item.coef,
        sortOrder: item.sortOrder,
        notes: item.notes,
        createdBy: user.id,
        updatedBy: user.id,
      }));
    });

    const items = await insertChunked(allItems, (slice) =>
      tx.insert(ahspLibraryItems).values(slice),
    );

    const created = fresh.length;
    const updated = known.length;

    await writeAuditLog(tx, {
      orgId: access.orgId,
      tableName: 'ahsp_library_entries',
      recordId: null,
      action: 'INSERT',
      before: null,
      after: { batch, created, updated, items },
      actorId: user.id,
    });

    return { batch, entriesCreated: created, entriesUpdated: updated, itemsWritten: items };
  });
}

export async function listLibraryEntries(
  userId: string,
  input: { search?: string; limit?: number; offset?: number } = {},
): Promise<{ items: LibraryEntryRow[]; total: number }> {
  const access = await assertOrgAccess(userId);
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const offset = Math.max(input.offset ?? 0, 0);

  const search = input.search?.trim();
  const filters = [
    eq(ahspLibraryEntries.orgId, access.orgId),
    eq(ahspLibraryEntries.isActive, true),
  ];
  if (search) {
    const pattern = `%${search}%`;
    const matches = or(
      ilike(ahspLibraryEntries.code, pattern),
      ilike(ahspLibraryEntries.name, pattern),
    );
    if (matches) filters.push(matches);
  }
  const where = and(...filters);

  const lineCount = sql<number>`(
    SELECT count(*)::int FROM ahsp_library_items i WHERE i.entry_id = ahsp_library_entries.id
  )`;

  const [[totalRow], rows] = await Promise.all([
    db.select({ value: count() }).from(ahspLibraryEntries).where(where),
    db
      .select({
        id: ahspLibraryEntries.id,
        code: ahspLibraryEntries.code,
        name: ahspLibraryEntries.name,
        unitCode: ahspLibraryEntries.unitCode,
        sourceName: ahspLibraryEntries.sourceName,
        sourceYear: ahspLibraryEntries.sourceYear,
        lineCount,
      })
      .from(ahspLibraryEntries)
      .where(where)
      .orderBy(asc(ahspLibraryEntries.code))
      .limit(limit)
      .offset(offset),
  ]);

  return { items: rows, total: totalRow?.value ?? 0 };
}

export type LibraryEntryDetail = {
  id: string;
  code: string;
  name: string;
  unitCode: string;
  sourceName: string | null;
  sourceYear: number | null;
  sourceDocument: string | null;
  sourceUrl: string | null;
  lines: {
    id: string;
    role: 'LABOR' | 'MATERIAL' | 'EQUIPMENT' | 'SUBCON' | 'PACKAGE';
    resourceCode: string | null;
    resourceName: string;
    unitCode: string;
    coef: string;
    /** The catalogue resource this line was matched to, if any. */
    matchedResourceId: string | null;
    matchedResourceCode: string | null;
  }[];
  matchedCount: number;
};

/**
 * Matches library lines to the organisation's own catalogue.
 *
 * By code where the source gives one, and by name otherwise — 590 of the
 * 16.136 lines in the national library carry a code, so refusing to match on
 * name would leave almost every analysis unusable. Name matching is case- and
 * space-insensitive and nothing cleverer: a fuzzy match that guesses wrong
 * puts the wrong material into an estimate, and the point of the unmatched
 * list is that a human resolves it.
 */
export async function getLibraryEntry(userId: string, entryId: string): Promise<LibraryEntryDetail> {
  const access = await assertOrgAccess(userId);

  const [entry] = await db
    .select()
    .from(ahspLibraryEntries)
    .where(and(eq(ahspLibraryEntries.id, entryId), eq(ahspLibraryEntries.orgId, access.orgId)))
    .limit(1);

  if (!entry) throw notFound('Analisa pustaka tidak ditemukan.');

  const lines = await db
    .select()
    .from(ahspLibraryItems)
    .where(eq(ahspLibraryItems.entryId, entryId))
    .orderBy(asc(ahspLibraryItems.sortOrder));

  const codes = [...new Set(lines.map((l) => l.resourceCode).filter((c): c is string => c !== null))];
  const names = [...new Set(lines.map((l) => l.resourceName.trim().toLowerCase()))];

  const candidates =
    lines.length === 0
      ? []
      : await db
          .select({ id: resources.id, code: resources.code, name: resources.name })
          .from(resources)
          .where(
            and(
              eq(resources.orgId, access.orgId),
              eq(resources.isActive, true),
              /*
               * `inArray` over an expression, not `= ANY(array)`.
               *
               * Drizzle interpolates a JavaScript array as a record, so the
               * ANY form reached Postgres as `(a, b, c)::text[]` and was
               * rejected outright — "cannot cast type record to text[]". The
               * list is bounded by the number of lines in one analysis, so an
               * IN list is the right shape anyway.
               */
              or(
                codes.length > 0 ? inArray(resources.code, codes) : sql`false`,
                names.length > 0
                  ? inArray(sql`lower(btrim(${resources.name}))`, names)
                  : sql`false`,
              ),
            ),
          );

  const byCode = new Map(candidates.map((r) => [r.code, r]));
  const byName = new Map(candidates.map((r) => [r.name.trim().toLowerCase(), r]));

  const resolved = lines.map((line) => {
    const match =
      (line.resourceCode === null ? undefined : byCode.get(line.resourceCode)) ??
      byName.get(line.resourceName.trim().toLowerCase()) ??
      null;

    return {
      id: line.id,
      role: line.role,
      resourceCode: line.resourceCode,
      resourceName: line.resourceName,
      unitCode: line.unitCode,
      coef: line.coef,
      matchedResourceId: match?.id ?? null,
      matchedResourceCode: match?.code ?? null,
    };
  });

  return {
    id: entry.id,
    code: entry.code,
    name: entry.name,
    unitCode: entry.unitCode,
    sourceName: entry.sourceName,
    sourceYear: entry.sourceYear,
    sourceDocument: entry.sourceDocument,
    sourceUrl: entry.sourceUrl,
    lines: resolved,
    matchedCount: resolved.filter((l) => l.matchedResourceId !== null).length,
  };
}

export type ApplyLibraryResult = {
  created: number;
  skippedExisting: number;
  unmatched: { resourceName: string; unitCode: string }[];
};

/**
 * Copies a library analysis onto a work item.
 *
 * Only lines that matched the catalogue are written; the rest come back named,
 * so the user can add the missing resources and apply again. Writing a
 * half-matched analysis silently would produce a unit rate that looks complete
 * and is not, which is the one outcome an estimate must never have.
 */
export async function applyLibraryEntry(
  user: SessionUser,
  projectId: string,
  workItemId: string,
  entryId: string,
  estimateType: 'RAB' | 'RAP',
): Promise<ApplyLibraryResult> {
  const access = await assertProjectAccess(user.id, projectId, 'ENGINEER');
  const detail = await getLibraryEntry(user.id, entryId);

  const usable = detail.lines.filter((l) => l.matchedResourceId !== null);
  const unmatched = detail.lines
    .filter((l) => l.matchedResourceId === null)
    .map((l) => ({ resourceName: l.resourceName, unitCode: l.unitCode }));

  if (usable.length === 0) {
    throw conflict(
      'Tidak ada satu pun sumber daya pada analisa ini yang cocok dengan katalog Anda.',
      'Tambahkan sumber dayanya di Master Data terlebih dahulu, lalu terapkan lagi.',
    );
  }

  return withUser(user.id, async (tx) => {
    const existing = await tx
      .select({ resourceId: workItemResources.resourceId, role: workItemResources.role })
      .from(workItemResources)
      .where(
        and(
          eq(workItemResources.workItemId, workItemId),
          eq(workItemResources.estimateType, estimateType),
        ),
      );

    const taken = new Set(existing.map((row) => `${row.resourceId}|${row.role}`));
    const fresh = usable.filter((l) => !taken.has(`${l.matchedResourceId}|${l.role}`));

    if (fresh.length > 0) {
      await tx.insert(workItemResources).values(
        fresh.map((line, index) => ({
          workItemId,
          resourceId: line.matchedResourceId as string,
          role: line.role,
          estimateType,
          coef: line.coef,
          wasteFactor: '0',
          note: `Pustaka ${detail.code}`,
          sortOrder: existing.length + index,
          createdBy: user.id,
          updatedBy: user.id,
        })),
      );
    }

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'work_item_resources',
      recordId: workItemId,
      action: 'INSERT',
      before: null,
      after: {
        source: 'ahsp_library',
        entryCode: detail.code,
        estimateType,
        created: fresh.length,
        unmatched: unmatched.length,
      },
      actorId: user.id,
    });

    return { created: fresh.length, skippedExisting: usable.length - fresh.length, unmatched };
  });
}
