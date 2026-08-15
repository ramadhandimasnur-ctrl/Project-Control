import { and, eq, inArray, isNull } from 'drizzle-orm';

import { withUser } from '@/db/context';
import { resourceCategories, resourcePrices, resources, units } from '@/db/schema';
import { type PriceType } from '@/lib/calc/price';
import {
  unitDimension,
  type ImportIssue,
  type UtbaParseResult,
} from '@/lib/import/utba';

import { assertOrgAccess } from './org-access';
import { writeAuditLog } from './audit';
import { type SessionUser } from './session';

/**
 * Persists a parsed UTBA sheet.
 *
 * Deliberately not marked `server-only`: this runs from the command line as
 * well as from the application, the same reason `src/db/index.ts` is exempt.
 *
 * Idempotent by design. Re-importing a corrected workbook is the normal way to
 * work, so the import matches on code and reports what it changed rather than
 * duplicating rows. Prices are never overwritten — a changed price becomes a
 * new dated entry, which is what makes an old estimate explainable.
 *
 * Everything happens in one transaction: a half-imported catalogue, with
 * resources present but their prices missing, is worse than no import at all.
 */

export type ImportOptions = {
  /** Effective date written on every imported price. */
  onDate: string;
  /**
   * Which price column the sheet's HARGA becomes. The source workbook is an
   * "ANALISA RAP", so its single price is the execution price; RAB is left for
   * the user to enter rather than invented by copying.
   */
  priceTypes: PriceType[];
  dryRun?: boolean;
};

export type ImportReport = {
  dryRun: boolean;
  units: { created: number; existing: number };
  categories: { created: number; existing: number };
  resources: { created: number; updated: number; unchanged: number };
  prices: { created: number; unchanged: number; superseded: number };
  issues: ImportIssue[];
};

export async function importUtba(
  user: SessionUser,
  parsed: UtbaParseResult,
  options: ImportOptions,
): Promise<ImportReport> {
  const access = await assertOrgAccess(user.id, 'ADMIN');

  const report: ImportReport = {
    dryRun: options.dryRun ?? false,
    units: { created: 0, existing: 0 },
    categories: { created: 0, existing: 0 },
    resources: { created: 0, updated: 0, unchanged: 0 },
    prices: { created: 0, unchanged: 0, superseded: 0 },
    issues: [...parsed.issues],
  };

  await withUser(user.id, async (tx) => {
    // --- units -------------------------------------------------------------
    const existingUnits = await tx
      .select({ id: units.id, code: units.code })
      .from(units)
      .where(eq(units.orgId, access.orgId));

    const unitIdByCode = new Map(existingUnits.map((u) => [u.code.toLowerCase(), u.id]));

    for (const unit of parsed.units) {
      if (unitIdByCode.has(unit.code)) {
        report.units.existing += 1;
        continue;
      }
      report.units.created += 1;

      const [created] = await tx
        .insert(units)
        .values({
          orgId: access.orgId,
          code: unit.code,
          name: unit.code,
          dimension: unitDimension(unit.code) ?? 'COUNT',
          createdBy: user.id,
          updatedBy: user.id,
        })
        .returning({ id: units.id });

      if (created) unitIdByCode.set(unit.code, created.id);
    }

    // --- categories --------------------------------------------------------
    const existingCategories = await tx
      .select({ id: resourceCategories.id, code: resourceCategories.code })
      .from(resourceCategories)
      .where(eq(resourceCategories.orgId, access.orgId));

    const categoryIdByCode = new Map(existingCategories.map((c) => [c.code, c.id]));

    // Parents before children, so the parent id is available to attach to.
    const ordered = [...parsed.categories].sort((a, b) => {
      if (a.parentCode === null && b.parentCode !== null) return -1;
      if (a.parentCode !== null && b.parentCode === null) return 1;
      return a.rowNumber - b.rowNumber;
    });

    for (const category of ordered) {
      if (categoryIdByCode.has(category.code)) {
        report.categories.existing += 1;
        continue;
      }
      report.categories.created += 1;

      const [created] = await tx
        .insert(resourceCategories)
        .values({
          orgId: access.orgId,
          code: category.code,
          name: category.name,
          type: category.type,
          parentId:
            category.parentCode === null
              ? null
              : (categoryIdByCode.get(category.parentCode) ?? null),
          createdBy: user.id,
          updatedBy: user.id,
        })
        .returning({ id: resourceCategories.id });

      if (created) categoryIdByCode.set(category.code, created.id);
    }

    // --- resources ---------------------------------------------------------
    const codes = parsed.resources.map((r) => r.code);
    const existingResources =
      codes.length === 0
        ? []
        : await tx
            .select({
              id: resources.id,
              code: resources.code,
              name: resources.name,
              spec: resources.spec,
              type: resources.type,
              unitId: resources.unitId,
              categoryId: resources.categoryId,
              notes: resources.notes,
            })
            .from(resources)
            .where(and(eq(resources.orgId, access.orgId), inArray(resources.code, codes)));

    const resourceByCode = new Map(existingResources.map((r) => [r.code, r]));
    const resourceIdByCode = new Map<string, string>();
    const toCreate: (typeof resources.$inferInsert)[] = [];

    for (const row of parsed.resources) {
      const unitId = unitIdByCode.get(row.unitCode);
      const categoryId = categoryIdByCode.get(row.categoryCode) ?? null;

      if (!unitId) {
        report.issues.push({
          rowNumber: row.rowNumber,
          code: row.code,
          severity: 'ERROR',
          message: `Satuan "${row.unitCode}" gagal disiapkan, sehingga baris ini dilewati.`,
        });
        continue;
      }

      const existing = resourceByCode.get(row.code);

      if (!existing) {
        // Batched below. A catalogue of 374 rows inserted one at a time is
        // ~400 round trips to a remote database, which turns a two-second
        // import into a two-minute one.
        toCreate.push({
          orgId: access.orgId,
          code: row.code,
          name: row.name,
          spec: row.spec,
          type: row.type,
          unitId,
          categoryId,
          notes: row.note,
          createdBy: user.id,
          updatedBy: user.id,
        });
        continue;
      }

      resourceIdByCode.set(row.code, existing.id);

      // The unit of an existing resource is never rewritten: changing it would
      // reinterpret every coefficient and quantity already recorded against
      // it. A genuine unit change is a deliberate act, not an import result.
      //
      // Because it is never applied, it is also excluded from the change
      // comparison below — otherwise these rows would report themselves as
      // "updated" on every single run, and the report would stop meaning
      // anything.
      if (existing.unitId !== unitId) {
        report.issues.push({
          rowNumber: row.rowNumber,
          code: row.code,
          severity: 'WARNING',
          message:
            'Satuan pada file berbeda dengan yang tersimpan; satuan lama dipertahankan agar koefisien dan kuantitas lama tetap sahih.',
        });
      }

      const changed =
        existing.name !== row.name ||
        existing.spec !== row.spec ||
        existing.type !== row.type ||
        existing.categoryId !== categoryId ||
        existing.notes !== row.note;

      if (!changed) {
        report.resources.unchanged += 1;
        continue;
      }

      report.resources.updated += 1;
      await tx
        .update(resources)
        .set({
          name: row.name,
          spec: row.spec,
          type: row.type,
          categoryId,
          notes: row.note,
          updatedBy: user.id,
        })
        .where(eq(resources.id, existing.id));
    }

    for (const chunk of chunked(toCreate, CHUNK_SIZE)) {
      const created = await tx
        .insert(resources)
        .values(chunk)
        .returning({ id: resources.id, code: resources.code });

      report.resources.created += created.length;
      for (const row of created) resourceIdByCode.set(row.code, row.id);
    }

    // --- prices ------------------------------------------------------------
    const resourceIds = [...resourceIdByCode.values()];
    const existingPrices =
      resourceIds.length === 0
        ? []
        : await tx
            .select({
              id: resourcePrices.id,
              resourceId: resourcePrices.resourceId,
              priceType: resourcePrices.priceType,
              price: resourcePrices.price,
            })
            .from(resourcePrices)
            .where(
              and(
                inArray(resourcePrices.resourceId, resourceIds),
                isNull(resourcePrices.projectId),
                eq(resourcePrices.effectiveFrom, options.onDate),
              ),
            );

    const priceKey = (resourceId: string, priceType: string) => `${resourceId}|${priceType}`;
    const priceOnDate = new Map(
      existingPrices.map((p) => [priceKey(p.resourceId, p.priceType), p]),
    );

    const supersededIds: string[] = [];
    const priceRows: (typeof resourcePrices.$inferInsert)[] = [];

    for (const row of parsed.resources) {
      const resourceId = resourceIdByCode.get(row.code);
      if (!resourceId) continue;

      for (const priceType of options.priceTypes) {
        const current = priceOnDate.get(priceKey(resourceId, priceType));

        if (current !== undefined) {
          // Same date, same value: nothing to record. Same date, new value:
          // replace, because two prices cannot both start on one day.
          if (Number(current.price) === Number(row.price)) {
            report.prices.unchanged += 1;
            continue;
          }
          report.prices.superseded += 1;
          supersededIds.push(current.id);
        } else {
          report.prices.created += 1;
        }

        priceRows.push({
          resourceId,
          projectId: null,
          priceType,
          price: row.price,
          effectiveFrom: options.onDate,
          source: 'Impor UTBA',
          createdBy: user.id,
          updatedBy: user.id,
        });
      }
    }

    for (const chunk of chunked(supersededIds, CHUNK_SIZE)) {
      await tx.delete(resourcePrices).where(inArray(resourcePrices.id, chunk));
    }
    for (const chunk of chunked(priceRows, CHUNK_SIZE)) {
      await tx.insert(resourcePrices).values(chunk);
    }

    await writeAuditLog(tx, {
      orgId: access.orgId,
      tableName: 'resources',
      action: 'INSERT',
      after: {
        source: 'UTBA',
        onDate: options.onDate,
        priceTypes: options.priceTypes,
        resources: report.resources,
        prices: report.prices,
      },
      actorId: user.id,
    });

    if (options.dryRun) {
      // Everything above ran for real, so the counts are exact rather than
      // predicted — then rolled back, leaving the database untouched.
      throw new DryRunRollback(report);
    }
  }).catch((error: unknown) => {
    if (error instanceof DryRunRollback) return;
    throw error;
  });

  return report;
}

/**
 * Rows per statement. Postgres caps a statement at 65535 parameters; 500 rows
 * of a dozen columns stays comfortably inside that while keeping the number of
 * round trips small.
 */
const CHUNK_SIZE = 500;

function* chunked<T>(items: readonly T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) {
    yield items.slice(i, i + size);
  }
}

/** Sentinel used to roll back a dry run once its true effect is known. */
class DryRunRollback extends Error {
  readonly report: ImportReport;
  constructor(report: ImportReport) {
    super('dry run');
    this.name = 'DryRunRollback';
    this.report = report;
  }
}
