import { randomUUID } from 'node:crypto';

import type ExcelJS from 'exceljs';
import { and, eq, getTableColumns, inArray, sql, type InferInsertModel } from 'drizzle-orm';
import type { AnyColumn } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';

import type { Transaction } from '@/db';
import { withUser } from '@/db/context';
import {
  importRefs,
  progressEntries,
  resourcePrices,
  resources,
  schedulePeriods,
  suppliers,
  units,
  workGroups,
  workItemResources,
  workItemSchedules,
  workItems,
  plannedDistributions,
  projects,
  projectMembers,
  foremen,
} from '@/db/schema';
import {
  decimalOrNull,
  excelSerialToDay,
  isLiveRow,
  readTable,
  textOrNull,
  type SheetRecord,
} from '@/lib/import/workbook';

import { assertOrgAccess } from './org-access';
import { writeAuditLog } from './audit';
import { type SessionUser } from './session';

/**
 * Brings a PROJECT_CONTROL workbook into the application.
 *
 * The workbook is already normalised — it keeps its data in `_DB_*` sheets
 * with its own keys — so this is not a spreadsheet-scraping exercise. What it
 * is, is a correlation problem: PRJ-0048 has to become the same project row on
 * every import, or a second run duplicates two hundred projects.
 *
 * `import_refs` holds that correlation. Every step looks its parents up
 * through it and records what it created, so the order below is the order the
 * data depends on, and nothing has to match on name.
 *
 * Read-only unless `apply` is given. The dry run does the whole import inside
 * a transaction and rolls it back, so the counts it reports are what actually
 * happened rather than a prediction — the same approach the UTBA importer
 * takes, and for the same reason: a prediction that disagrees with the result
 * is worse than no prediction.
 */

export type StepResult = {
  sheet: string;
  label: string;
  /** Live rows handed to the step. Always created + updated + skipped. */
  read: number;
  /** Rows the workbook itself had marked deleted, counted but not read. */
  deleted: number;
  created: number;
  updated: number;
  skipped: number;
  issues: string[];
};

export type WorkbookImportReport = {
  batch: string;
  source: string;
  dryRun: boolean;
  steps: StepResult[];
  totals: { created: number; updated: number; skipped: number };
};

type Ctx = {
  tx: Transaction;
  orgId: string;
  userId: string;
  source: string;
  batch: string;
  /** Excel key → row id here, for everything imported so far. */
  refs: Map<string, string>;
  pending: {
    sourceTable: string;
    sourceId: string;
    targetTable: string;
    targetId: string;
  }[];
};

const refKey = (sourceTable: string, sourceId: string): string => `${sourceTable} ${sourceId}`;

/**
 * The ids of every project this import touched, for the steps that hang off
 * them. Preloading "what is already there" has to be bounded by something, and
 * the projects in the workbook are the honest bound.
 */
const importedProjectIds = (ctx: Ctx): string[] => [
  ...new Set(
    [...ctx.refs.entries()]
      .filter(([key]) => key.startsWith('_DB_PROJECT '))
      .map(([, id]) => id),
  ),
];

/** The same for work items, which the AHSP, schedule and progress steps read by. */
const importedWorkItemIds = (ctx: Ctx): string[] => [
  ...new Set(
    [...ctx.refs.entries()]
      .filter(([key]) => key.startsWith('_DB_WORKITEM '))
      .map(([, id]) => id),
  ),
];

/** Rows per statement. Large enough to matter, small enough to stay readable in a log. */
const WRITE_CHUNK = 500;

/**
 * Inserts rows in chunks, with no conflict clause.
 *
 * Kept separate from `writeChunks` because of a sharp edge in row-level
 * security: a statement carrying any `ON CONFLICT` clause has the table's
 * *read* policy applied to the row being inserted, since the database must be
 * able to see the row it might have to update. For `projects` and
 * `project_members` that read policy is membership-based, and a project nobody
 * is yet a member of fails it — so those two tables are written plainly, and
 * their duplicates are resolved here rather than by the database.
 */
async function insertChunks<T extends PgTable>(
  tx: Transaction,
  table: T,
  rows: InferInsertModel<T>[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
    await tx.insert(table).values(rows.slice(i, i + WRITE_CHUNK));
  }
}

/**
 * Writes a step's rows: inserting what is new, refreshing what is not.
 *
 * One statement per five hundred rows rather than one per row. The database is
 * in Tokyo and every round trip costs the better part of a tenth of a second;
 * written a row at a time this workbook's eleven thousand rows spent half an
 * hour almost entirely waiting, which is long enough that no web request could
 * ever carry the import.
 *
 * Keyed on the primary key, which the caller already knows — a new row gets a
 * generated id, an existing one the id `import_refs` recorded. `created_by`
 * and `created_at` are deliberately not among the refreshed columns: who first
 * imported a row is not something a later import may rewrite.
 */
async function writeChunks<T extends PgTable>(
  tx: Transaction,
  table: T,
  rows: InferInsertModel<T>[],
  refresh: readonly (keyof T['_']['columns'] & string)[],
): Promise<void> {
  if (rows.length === 0) return;

  const columns = getTableColumns(table) as Record<string, AnyColumn>;

  const assignments: Record<string, unknown> = {};
  for (const key of refresh) {
    const column = columns[key];
    if (column === undefined) continue;
    assignments[key] = sql`excluded.${sql.identifier(column.name)}`;
  }
  // `$onUpdate` does not fire on a conflict clause, so the timestamp is set here.
  if (columns['updatedAt'] !== undefined) assignments['updatedAt'] = sql`now()`;

  /*
   * The same id twice in one statement is rejected outright ("cannot affect
   * row a second time"), and a workbook with two rows carrying one key is
   * ordinary rather than exceptional. The last one wins, which is what writing
   * them one after another would have done.
   */
  const unique = new Map<unknown, InferInsertModel<T>>();
  for (const row of rows) unique.set((row as { id?: unknown }).id, row);
  const deduped = [...unique.values()];

  for (let i = 0; i < deduped.length; i += WRITE_CHUNK) {
    await tx
      .insert(table)
      .values(deduped.slice(i, i + WRITE_CHUNK))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .onConflictDoUpdate({ target: columns['id'] as any, set: assignments as any });
  }
}

/**
 * Makes the importing user a member of every project imported.
 *
 * Not a convenience. Every project-scoped table reads through
 * `pc_can_access_project`, and a project nobody is a member of is a project
 * nothing can be written into.
 */
async function addMemberships(ctx: Ctx, projectIds: readonly string[]): Promise<void> {
  const unique = [...new Set(projectIds)];
  if (unique.length === 0) return;

  /*
   * Which memberships are missing is worked out here rather than left to an
   * `ON CONFLICT DO NOTHING`, which this table cannot have: see
   * `insertChunks`. A project this user cannot yet see returns no rows, which
   * is exactly the answer wanted — there is nothing to conflict with.
   */
  const existing = await ctx.tx
    .select({ projectId: projectMembers.projectId })
    .from(projectMembers)
    .where(and(inArray(projectMembers.projectId, unique), eq(projectMembers.userId, ctx.userId)));
  const have = new Set(existing.map((row) => row.projectId));

  await insertChunks(
    ctx.tx,
    projectMembers,
    unique
      .filter((projectId) => !have.has(projectId))
      .map((projectId) => ({
        projectId,
        userId: ctx.userId,
        role: 'PROJECT_MANAGER' as const,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })),
  );
}

const resolve = (ctx: Ctx, sourceTable: string, sourceId: string | null): string | null =>
  sourceId === null ? null : (ctx.refs.get(refKey(sourceTable, sourceId)) ?? null);

function remember(
  ctx: Ctx,
  sourceTable: string,
  sourceId: string,
  targetTable: string,
  targetId: string,
): void {
  ctx.refs.set(refKey(sourceTable, sourceId), targetId);
  ctx.pending.push({ sourceTable, sourceId, targetTable, targetId });
}

/*
 * A dimension the application understands.
 *
 * The workbook leaves it blank on 180 of its units and has one `OTHER`.
 * Neither can be converted to anything, which is precisely what LUMPSUM means
 * here, so both land there rather than being guessed into a real dimension
 * where a wrong conversion would silently rescale a quantity.
 */
const DIMENSIONS = new Set(['LENGTH', 'AREA', 'VOLUME', 'MASS', 'COUNT', 'TIME', 'LUMPSUM']);
const dimensionOf = (value: string | null): 'LENGTH' | 'AREA' | 'VOLUME' | 'MASS' | 'COUNT' | 'TIME' | 'LUMPSUM' => {
  const text = (value ?? '').trim().toUpperCase();
  return DIMENSIONS.has(text) ? (text as 'LENGTH') : 'LUMPSUM';
};

const RESOURCE_TYPES = new Set(['LABOR', 'MATERIAL', 'EQUIPMENT', 'SUBCON', 'PACKAGE', 'OVERHEAD']);

// --- steps ------------------------------------------------------------------

type Step = {
  sheet: string;
  label: string;
  run(rows: SheetRecord[], ctx: Ctx, result: StepResult): Promise<void>;
};

/**
 * Units are keyed by their code, not by an id — the workbook's unit table has
 * no id column, which is fair enough for a list of thirty codes.
 */
const unitStep: Step = {
  sheet: '_DB_UNIT',
  label: 'Satuan',
  async run(rows, ctx, result) {
    const existing = await ctx.tx
      .select({ id: units.id, code: units.code })
      .from(units)
      .where(eq(units.orgId, ctx.orgId));
    const byCode = new Map(existing.map((row) => [row.code, row.id]));
    const queue: InferInsertModel<typeof units>[] = [];

    let blankDimension = 0;

    for (const row of rows) {
      const code = textOrNull(row.get('UnitCode'));
      if (code === null) {
        result.skipped += 1;
        continue;
      }

      if (textOrNull(row.get('UnitType')) === null) blankDimension += 1;

      const values = {
        name: textOrNull(row.get('UnitName')) ?? code,
        dimension: dimensionOf(row.get('UnitType')),
        updatedBy: ctx.userId,
      };

      const found = byCode.get(code);
      const id = found ?? randomUUID();
      queue.push({ ...values, id, orgId: ctx.orgId, code, createdBy: ctx.userId });
      byCode.set(code, id);
      remember(ctx, '_DB_UNIT', code, 'units', id);
      if (found === undefined) result.created += 1;
      else result.updated += 1;
    }

    await writeChunks(ctx.tx, units, queue, ['name', 'dimension', 'updatedBy']);

    if (blankDimension > 0) {
      result.issues.push(
        `${blankDimension} satuan tidak menyebut dimensinya dan dicatat sebagai LUMPSUM. ` +
          'Satuan tanpa dimensi tidak dapat dikonversi; perbaiki di Master Data bila perlu.',
      );
    }
  },
};

const resourceStep: Step = {
  sheet: '_DB_RESOURCE',
  label: 'Sumber daya',
  async run(rows, ctx, result) {
    const existing = await ctx.tx
      .select({ id: resources.id, code: resources.code })
      .from(resources)
      .where(eq(resources.orgId, ctx.orgId));
    const byCode = new Map(existing.map((row) => [row.code, row.id]));
    const queue: InferInsertModel<typeof resources>[] = [];

    let blankCategory = 0;
    let missingUnit = 0;

    for (const row of rows) {
      const sourceId = textOrNull(row.get('ResourceID'));
      const code = textOrNull(row.get('ResourceCode'));
      if (sourceId === null || code === null) {
        result.skipped += 1;
        continue;
      }

      const unitId = resolve(ctx, '_DB_UNIT', textOrNull(row.get('Unit')));
      if (unitId === null) {
        missingUnit += 1;
        result.skipped += 1;
        continue;
      }

      const category = (textOrNull(row.get('Category')) ?? '').toUpperCase();
      if (!RESOURCE_TYPES.has(category)) blankCategory += 1;

      const values = {
        name: textOrNull(row.get('ResourceName')) ?? code,
        spec: textOrNull(row.get('SubCategory')),
        unitId,
        /*
         * MATERIAL when the workbook does not say. It is the commonest kind and
         * the one that behaves most conservatively — a material can be stocked
         * and issued, which a misfiled labour line simply never will be. The
         * count is reported so the guess can be corrected rather than inherited.
         */
        type: (RESOURCE_TYPES.has(category) ? category : 'MATERIAL') as 'MATERIAL',
        isActive: textOrNull(row.get('IsActive')) !== '0',
        notes: textOrNull(row.get('Notes')),
        updatedBy: ctx.userId,
      };

      const found = byCode.get(code);
      const id = found ?? randomUUID();
      queue.push({ ...values, id, orgId: ctx.orgId, code, createdBy: ctx.userId });
      byCode.set(code, id);
      remember(ctx, '_DB_RESOURCE', sourceId, 'resources', id);
      if (found === undefined) result.created += 1;
      else result.updated += 1;
    }

    await writeChunks(ctx.tx, resources, queue, [
      'name',
      'spec',
      'unitId',
      'type',
      'isActive',
      'notes',
      'updatedBy',
    ]);

    if (missingUnit > 0) {
      result.issues.push(`${missingUnit} sumber daya dilewati karena satuannya tidak dikenal.`);
    }
    if (blankCategory > 0) {
      result.issues.push(
        `${blankCategory} sumber daya tidak berkategori dan dicatat sebagai MATERIAL. ` +
          'Peran baris AHSP mengikuti kategori ini, jadi periksa di Master Data.',
      );
    }
  },
};

const supplierStep: Step = {
  sheet: '_DB_SUPPLIER',
  label: 'Pemasok',
  async run(rows, ctx, result) {
    const existing = await ctx.tx
      .select({ id: suppliers.id, code: suppliers.code })
      .from(suppliers)
      .where(eq(suppliers.orgId, ctx.orgId));
    const byCode = new Map(existing.map((row) => [row.code, row.id]));
    const queue: InferInsertModel<typeof suppliers>[] = [];

    for (const row of rows) {
      const sourceId = textOrNull(row.get('SupplierID'));
      const name = textOrNull(row.get('SupplierName'));
      if (sourceId === null || name === null) {
        result.skipped += 1;
        continue;
      }

      /*
       * The workbook gives suppliers no code, only a name and an id. The id
       * becomes the code: it is stable, unique, and traceable back to the row
       * it came from — which a name is not, since two suppliers are routinely
       * called the same thing.
       */
      const code = sourceId;
      const values = {
        name,
        contact: textOrNull(row.get('Contact')) ?? textOrNull(row.get('Phone')),
        address: textOrNull(row.get('Address')),
        creditDays: Number(textOrNull(row.get('DefaultTermDays')) ?? '0') || 0,
        updatedBy: ctx.userId,
      };

      const found = byCode.get(code);
      const id = found ?? randomUUID();
      queue.push({ ...values, id, orgId: ctx.orgId, code, createdBy: ctx.userId });
      byCode.set(code, id);
      remember(ctx, '_DB_SUPPLIER', sourceId, 'suppliers', id);
      if (found === undefined) result.created += 1;
      else result.updated += 1;
    }

    await writeChunks(ctx.tx, suppliers, queue, [
      'name',
      'contact',
      'address',
      'creditDays',
      'updatedBy',
    ]);
  },
};

const foremanStep: Step = {
  sheet: '_DB_FOREMAN',
  label: 'Mandor',
  async run(rows, ctx, result) {
    const existing = await ctx.tx
      .select({ id: foremen.id, code: foremen.code })
      .from(foremen)
      .where(eq(foremen.orgId, ctx.orgId));
    const byCode = new Map(existing.map((row) => [row.code, row.id]));
    const queue: InferInsertModel<typeof foremen>[] = [];

    for (const row of rows) {
      const sourceId = textOrNull(row.get('ForemanID'));
      const name = textOrNull(row.get('ForemanName'));
      if (sourceId === null || name === null) {
        result.skipped += 1;
        continue;
      }

      const code = textOrNull(row.get('ForemanCode')) ?? sourceId;
      const values = {
        name,
        phone: textOrNull(row.get('Phone')),
        address: textOrNull(row.get('Address')),
        bankAccount: textOrNull(row.get('BankAccount')),
        isActive: textOrNull(row.get('IsActive')) !== '0',
        note: textOrNull(row.get('Notes')),
        updatedBy: ctx.userId,
      };

      const found = byCode.get(code);
      const id = found ?? randomUUID();
      queue.push({ ...values, id, orgId: ctx.orgId, code, createdBy: ctx.userId });
      byCode.set(code, id);
      remember(ctx, '_DB_FOREMAN', sourceId, 'foremen', id);
      if (found === undefined) result.created += 1;
      else result.updated += 1;
    }

    await writeChunks(ctx.tx, foremen, queue, [
      'name',
      'phone',
      'address',
      'bankAccount',
      'isActive',
      'note',
      'updatedBy',
    ]);
  },
};

const projectStep: Step = {
  sheet: '_DB_PROJECT',
  label: 'Proyek',
  async run(rows, ctx, result) {
    let missingDates = 0;

    /*
     * Projects already here, by code. A project the workbook knows may also
     * have been created by hand before the first import; matching on the code
     * adopts it instead of colliding with the unique index, and the correlation
     * row written afterwards means every later import finds it by key.
     */
    const visible = await ctx.tx
      .select({ id: projects.id, code: projects.code })
      .from(projects)
      .where(eq(projects.orgId, ctx.orgId));
    const byCode = new Map(visible.map((p) => [p.code, p.id]));
    const fresh: InferInsertModel<typeof projects>[] = [];
    const changed: { id: string; values: Record<string, unknown> }[] = [];
    const touchedProjects: string[] = [];

    for (const row of rows) {
      const sourceId = textOrNull(row.get('ProjectID'));
      const code = textOrNull(row.get('ProjectCode'));
      const name = textOrNull(row.get('ProjectName'));
      if (sourceId === null || code === null || name === null) {
        result.skipped += 1;
        continue;
      }

      const startDate = excelSerialToDay(row.get('StartDate'));
      const endDate = excelSerialToDay(row.get('FinishDate'));
      if (startDate === null || endDate === null) {
        missingDates += 1;
        result.skipped += 1;
        continue;
      }

      const values = {
        name,
        location: textOrNull(row.get('Location')),
        contractValue: decimalOrNull(row.get('ContractValue')) ?? '0',
        startDate,
        endDate,
        notes: textOrNull(row.get('Notes')),
        updatedBy: ctx.userId,
      };

      const existingId = resolve(ctx, '_DB_PROJECT', sourceId) ?? byCode.get(code) ?? null;
      const projectId = existingId ?? randomUUID();

      if (existingId === null) {
        fresh.push({ ...values, id: projectId, orgId: ctx.orgId, code, createdBy: ctx.userId });
        result.created += 1;
      } else {
        changed.push({ id: projectId, values });
        result.updated += 1;
      }

      byCode.set(code, projectId);
      touchedProjects.push(projectId);
      remember(ctx, '_DB_PROJECT', sourceId, 'projects', projectId);
    }

    await insertChunks(ctx.tx, projects, fresh);

    /*
     * Membership comes straight after the projects and before anything that
     * hangs off them. Every project-scoped table reads through
     * `pc_can_access_project`, so until this row exists the work groups, items
     * and progress that follow would be written into a project their own
     * author cannot see — and the next import would find none of it.
     */
    await addMemberships(ctx, touchedProjects);

    /*
     * One statement per changed project, which is the price of not being able
     * to use a conflict clause here. Only a re-import pays it, and only for
     * projects the workbook already placed.
     */
    for (const row of changed) {
      await ctx.tx.update(projects).set(row.values).where(eq(projects.id, row.id));
    }

    if (missingDates > 0) {
      result.issues.push(
        `${missingDates} proyek dilewati karena tanggal mulai atau selesainya kosong. ` +
          'Keduanya wajib di sini, karena jadwal dan kurva-S dihitung dari rentang itu.',
      );
    }
  },
};

const workGroupStep: Step = {
  sheet: '_DB_WBS',
  label: 'Kelompok pekerjaan',
  async run(rows, ctx, result) {
    /*
     * Keyed by project and code, not by the workbook's own id.
     *
     * `work_groups` is unique on that pair, and the workbook is not: a group
     * renumbered by hand arrives twice under two WbsIDs. Resolving the natural
     * key first means the second row updates the first rather than colliding
     * with it — and a group created in the app before the import is adopted
     * instead of duplicated.
     */
    const projectIds = importedProjectIds(ctx);
    const existing =
      projectIds.length === 0
        ? []
        : await ctx.tx
            .select({ id: workGroups.id, projectId: workGroups.projectId, code: workGroups.code })
            .from(workGroups)
            .where(inArray(workGroups.projectId, projectIds));
    const byKey = new Map(existing.map((r) => [`${r.projectId} ${r.code}`, r.id]));
    const queue: InferInsertModel<typeof workGroups>[] = [];

    for (const row of rows) {
      const sourceId = textOrNull(row.get('WbsID'));
      const projectId = resolve(ctx, '_DB_PROJECT', textOrNull(row.get('ProjectID')));
      const code = textOrNull(row.get('WbsCode'));
      const name = textOrNull(row.get('WbsName'));
      if (sourceId === null || projectId === null || name === null) {
        result.skipped += 1;
        continue;
      }

      const values = {
        code: code ?? name.slice(0, 32),
        name,
        sortOrder: Number(textOrNull(row.get('SortOrder')) ?? '0') || 0,
        updatedBy: ctx.userId,
      };

      const natural = `${projectId} ${values.code}`;
      const existingId = resolve(ctx, '_DB_WBS', sourceId) ?? byKey.get(natural) ?? null;
      const id = existingId ?? randomUUID();

      queue.push({ ...values, id, projectId, createdBy: ctx.userId });
      byKey.set(natural, id);
      remember(ctx, '_DB_WBS', sourceId, 'work_groups', id);
      if (existingId === null) result.created += 1;
      else result.updated += 1;
    }

    await writeChunks(ctx.tx, workGroups, queue, ['code', 'name', 'sortOrder', 'updatedBy']);
  },
};

const workItemStep: Step = {
  sheet: '_DB_WORKITEM',
  label: 'Item pekerjaan',
  async run(rows, ctx, result) {
    let missingUnit = 0;

    // Project and code, for the same reason the work groups are: that pair is
    // what the table is unique on, and the workbook's own id is not.
    const projectIds = importedProjectIds(ctx);
    const existing =
      projectIds.length === 0
        ? []
        : await ctx.tx
            .select({ id: workItems.id, projectId: workItems.projectId, code: workItems.code })
            .from(workItems)
            .where(inArray(workItems.projectId, projectIds));
    const byKey = new Map(existing.map((r) => [`${r.projectId} ${r.code}`, r.id]));
    const queue: InferInsertModel<typeof workItems>[] = [];

    for (const row of rows) {
      const sourceId = textOrNull(row.get('WorkItemID'));
      const projectId = resolve(ctx, '_DB_PROJECT', textOrNull(row.get('ProjectID')));
      const code = textOrNull(row.get('ItemCode'));
      const name = textOrNull(row.get('Description'));
      if (sourceId === null || projectId === null || code === null || name === null) {
        result.skipped += 1;
        continue;
      }

      const unitId = resolve(ctx, '_DB_UNIT', textOrNull(row.get('Unit')));
      if (unitId === null) {
        missingUnit += 1;
        result.skipped += 1;
        continue;
      }

      const values = {
        groupId: resolve(ctx, '_DB_WBS', textOrNull(row.get('WbsID'))),
        name,
        unitId,
        volume: decimalOrNull(row.get('Volume')) ?? '0',
        /*
         * The typed unit prices are carried across, but only as the fallback
         * they are here: an item with an analysis is priced by its analysis.
         * The workbook's TotalRAB and TotalRAP are deliberately not imported —
         * they are products, and importing a product alongside its factors is
         * how the two come to disagree.
         */
        unitPriceRab: decimalOrNull(row.get('UnitPriceRAB')),
        unitPriceRap: decimalOrNull(row.get('UnitPriceRAP')),
        isActive: textOrNull(row.get('IsActive')) !== '0',
        sortOrder: Number(textOrNull(row.get('SortOrder')) ?? '0') || 0,
        updatedBy: ctx.userId,
      };

      const natural = `${projectId} ${code}`;
      const existingId = resolve(ctx, '_DB_WORKITEM', sourceId) ?? byKey.get(natural) ?? null;
      const id = existingId ?? randomUUID();

      queue.push({ ...values, id, projectId, code, createdBy: ctx.userId });
      byKey.set(natural, id);
      remember(ctx, '_DB_WORKITEM', sourceId, 'work_items', id);
      if (existingId === null) result.created += 1;
      else result.updated += 1;
    }

    await writeChunks(ctx.tx, workItems, queue, [
      'groupId',
      'name',
      'unitId',
      'volume',
      'unitPriceRab',
      'unitPriceRap',
      'isActive',
      'sortOrder',
      'updatedBy',
    ]);

    if (missingUnit > 0) {
      result.issues.push(`${missingUnit} item pekerjaan dilewati karena satuannya tidak dikenal.`);
    }
  },
};

/**
 * One workbook line becomes two here, and that is the honest reading.
 *
 * The workbook keeps a single coefficient per resource with two frozen prices
 * beside it — RAB and RAP share the analysis and differ only in what the
 * resource is priced at. This application splits the two analyses so each can
 * name different resources. Importing the line to both sides with the same
 * coefficient says exactly what the workbook says; importing it to one would
 * leave the other analysis empty and every unit rate on that side zero.
 */
const workItemResourceStep: Step = {
  sheet: '_DB_WORKITEMRESOURCE',
  label: 'Baris AHSP',
  async run(rows, ctx, result) {
    const resourceRoles = await ctx.tx
      .select({ id: resources.id, type: resources.type })
      .from(resources)
      .where(eq(resources.orgId, ctx.orgId));
    const roleOf = new Map(resourceRoles.map((row) => [row.id, row.type]));

    /*
     * Keyed as the table is: item, estimate, resource, role. A workbook that
     * names the same resource twice in one analysis — two lines of the same
     * sand with different coefficients — would otherwise collide, and what it
     * means is a correction, so the later line wins.
     */
    const itemIds = importedWorkItemIds(ctx);
    const existingLines =
      itemIds.length === 0
        ? []
        : await ctx.tx
            .select({
              id: workItemResources.id,
              workItemId: workItemResources.workItemId,
              estimateType: workItemResources.estimateType,
              resourceId: workItemResources.resourceId,
              role: workItemResources.role,
            })
            .from(workItemResources)
            .where(inArray(workItemResources.workItemId, itemIds));
    const byKey = new Map(
      existingLines.map((r) => [`${r.workItemId} ${r.estimateType} ${r.resourceId} ${r.role}`, r.id]),
    );
    const queue: InferInsertModel<typeof workItemResources>[] = [];

    let unresolved = 0;
    let unusableRole = 0;

    for (const row of rows) {
      const sourceId = textOrNull(row.get('WirID'));
      const workItemId = resolve(ctx, '_DB_WORKITEM', textOrNull(row.get('WorkItemID')));
      const resourceId = resolve(ctx, '_DB_RESOURCE', textOrNull(row.get('ResourceID')));
      if (sourceId === null || workItemId === null || resourceId === null) {
        unresolved += 1;
        result.skipped += 1;
        continue;
      }

      const type = roleOf.get(resourceId);
      // OVERHEAD is a costing bucket, not something an AHSP line can hold.
      const role =
        type === 'LABOR' || type === 'MATERIAL' || type === 'EQUIPMENT' || type === 'SUBCON' || type === 'PACKAGE'
          ? type
          : null;
      if (role === null) {
        unusableRole += 1;
        result.skipped += 1;
        continue;
      }

      const coef = decimalOrNull(row.get('Coefficient')) ?? '0';
      const sortOrder = Number(textOrNull(row.get('SortOrder')) ?? '0') || 0;

      for (const estimateType of ['RAB', 'RAP'] as const) {
        const key = `${sourceId}:${estimateType}`;
        const values = {
          role,
          coef,
          wasteFactor: '0',
          sortOrder,
          updatedBy: ctx.userId,
        };

        const natural = `${workItemId} ${estimateType} ${resourceId} ${role}`;
        const existingId =
          resolve(ctx, '_DB_WORKITEMRESOURCE', key) ?? byKey.get(natural) ?? null;
        const id = existingId ?? randomUUID();

        queue.push({ ...values, id, workItemId, resourceId, estimateType, createdBy: ctx.userId });
        byKey.set(natural, id);
        remember(ctx, '_DB_WORKITEMRESOURCE', key, 'work_item_resources', id);
        if (existingId === null) result.created += 1;
        else result.updated += 1;
      }
    }

    await writeChunks(ctx.tx, workItemResources, queue, [
      'role',
      'coef',
      'wasteFactor',
      'sortOrder',
      'updatedBy',
    ]);

    if (unresolved > 0) {
      result.issues.push(
        `${unresolved} baris dilewati karena pekerjaan atau sumber dayanya tidak terimpor.`,
      );
    }
    if (unusableRole > 0) {
      result.issues.push(
        `${unusableRole} baris dilewati karena jenis sumber dayanya tidak dapat menjadi baris AHSP.`,
      );
    }
  },
};

const priceStep: Step = {
  sheet: '_DB_RESOURCEPRICE',
  label: 'Harga sumber daya',
  async run(rows, ctx, result) {
    let unresolved = 0;
    let collapsed = 0;

    /*
     * A price is identified by what it prices, not by the workbook's PriceID.
     *
     * The table is unique on resource, scope, type and effective date, and the
     * workbook is not: a price corrected twice on the same day leaves two rows
     * behind it. Two rows saying what one resource cost on one day is not two
     * prices, it is one price edited, so the later row wins and the count is
     * reported.
     */
    const existing = await ctx.tx
      .select({
        id: resourcePrices.id,
        resourceId: resourcePrices.resourceId,
        projectId: resourcePrices.projectId,
        priceType: resourcePrices.priceType,
        effectiveFrom: resourcePrices.effectiveFrom,
      })
      .from(resourcePrices)
      .innerJoin(resources, eq(resources.id, resourcePrices.resourceId))
      .where(eq(resources.orgId, ctx.orgId));
    const byKey = new Map(
      existing.map((r) => [
        `${r.resourceId} ${r.projectId ?? '-'} ${r.priceType} ${r.effectiveFrom}`,
        r.id,
      ]),
    );
    const seen = new Set<string>();
    const queue: InferInsertModel<typeof resourcePrices>[] = [];

    for (const row of rows) {
      const sourceId = textOrNull(row.get('PriceID'));
      const resourceId = resolve(ctx, '_DB_RESOURCE', textOrNull(row.get('ResourceID')));
      const priceType = (textOrNull(row.get('PriceType')) ?? '').toUpperCase();
      const price = decimalOrNull(row.get('UnitPrice'));
      const effectiveFrom = excelSerialToDay(row.get('EffectiveDate'));

      if (
        sourceId === null ||
        resourceId === null ||
        price === null ||
        effectiveFrom === null ||
        (priceType !== 'RAB' && priceType !== 'RAP')
      ) {
        unresolved += 1;
        result.skipped += 1;
        continue;
      }

      const values = {
        price,
        effectiveFrom,
        source: textOrNull(row.get('Source')),
        updatedBy: ctx.userId,
      };

      // A project-scoped price needs the project imported first; where it is
      // not, the price still belongs to the catalogue.
      const projectId = resolve(ctx, '_DB_PROJECT', textOrNull(row.get('ProjectID')));
      const natural = `${resourceId} ${projectId ?? '-'} ${priceType} ${effectiveFrom}`;
      if (seen.has(natural)) collapsed += 1;
      seen.add(natural);

      const existingId = resolve(ctx, '_DB_RESOURCEPRICE', sourceId) ?? byKey.get(natural) ?? null;
      const id = existingId ?? randomUUID();

      queue.push({ ...values, id, resourceId, projectId, priceType, createdBy: ctx.userId });
      byKey.set(natural, id);
      remember(ctx, '_DB_RESOURCEPRICE', sourceId, 'resource_prices', id);
      if (existingId === null) result.created += 1;
      else result.updated += 1;
    }

    await writeChunks(ctx.tx, resourcePrices, queue, ['price', 'effectiveFrom', 'source', 'updatedBy']);

    if (unresolved > 0) {
      result.issues.push(`${unresolved} harga dilewati: sumber daya, jenis, atau tanggalnya kosong.`);
    }
    if (collapsed > 0) {
      result.issues.push(
        `${collapsed} baris harga menyebut sumber daya, lingkup, jenis dan tanggal berlaku yang sama ` +
          'dengan baris lain, sehingga digabung menjadi satu — yang terakhir dipakai.',
      );
    }
  },
};

const periodStep: Step = {
  sheet: '_DB_PERIOD',
  label: 'Periode',
  async run(rows, ctx, result) {
    // Project and sequence number: two periods numbered 3 in one project are a
    // renumbering, not a second week.
    const projectIds = importedProjectIds(ctx);
    const existing =
      projectIds.length === 0
        ? []
        : await ctx.tx
            .select({
              id: schedulePeriods.id,
              projectId: schedulePeriods.projectId,
              seq: schedulePeriods.seq,
            })
            .from(schedulePeriods)
            .where(inArray(schedulePeriods.projectId, projectIds));
    const byKey = new Map(existing.map((r) => [`${r.projectId} ${r.seq}`, r.id]));
    const queue: InferInsertModel<typeof schedulePeriods>[] = [];

    for (const row of rows) {
      const sourceId = textOrNull(row.get('PeriodID'));
      const projectId = resolve(ctx, '_DB_PROJECT', textOrNull(row.get('ProjectID')));
      const startDate = excelSerialToDay(row.get('StartDate'));
      const endDate = excelSerialToDay(row.get('EndDate'));
      const seq = Number(textOrNull(row.get('PeriodNo')) ?? '0') || 0;

      if (sourceId === null || projectId === null || startDate === null || endDate === null || seq < 1) {
        result.skipped += 1;
        continue;
      }

      const periodType = (textOrNull(row.get('PeriodType')) ?? 'WEEK').toUpperCase();
      const values = {
        periodType: (periodType === 'DAY' || periodType === 'MONTH' ? periodType : 'WEEK') as 'WEEK',
        label: textOrNull(row.get('Label')) ?? `Periode ${seq}`,
        startDate,
        endDate,
        updatedBy: ctx.userId,
      };

      const natural = `${projectId} ${seq}`;
      const existingId = resolve(ctx, '_DB_PERIOD', sourceId) ?? byKey.get(natural) ?? null;
      const id = existingId ?? randomUUID();

      queue.push({ ...values, id, projectId, seq, createdBy: ctx.userId });
      byKey.set(natural, id);
      remember(ctx, '_DB_PERIOD', sourceId, 'schedule_periods', id);
      if (existingId === null) result.created += 1;
      else result.updated += 1;
    }

    await writeChunks(ctx.tx, schedulePeriods, queue, [
      'periodType',
      'label',
      'startDate',
      'endDate',
      'updatedBy',
    ]);
  },
};

const progressStep: Step = {
  sheet: '_DB_PROGRESS',
  label: 'Progres',
  async run(rows, ctx, result) {
    const itemIds = importedWorkItemIds(ctx);

    const volumes =
      itemIds.length === 0
        ? []
        : await ctx.tx
            .select({ id: workItems.id, volume: workItems.volume })
            .from(workItems)
            .where(inArray(workItems.id, itemIds));
    const volumeOf = new Map(volumes.map((row) => [row.id, row.volume]));

    // One entry per item per period, which is what the table holds. A workbook
    // with two entries for one week is one week's work recorded twice.
    const existing =
      itemIds.length === 0
        ? []
        : await ctx.tx
            .select({
              id: progressEntries.id,
              workItemId: progressEntries.workItemId,
              periodId: progressEntries.periodId,
            })
            .from(progressEntries)
            .where(inArray(progressEntries.workItemId, itemIds));
    const byKey = new Map(existing.map((r) => [`${r.workItemId} ${r.periodId}`, r.id]));
    const queue: InferInsertModel<typeof progressEntries>[] = [];

    let unresolved = 0;

    for (const row of rows) {
      const sourceId = textOrNull(row.get('ProgressID'));
      const projectId = resolve(ctx, '_DB_PROJECT', textOrNull(row.get('ProjectID')));
      const workItemId = resolve(ctx, '_DB_WORKITEM', textOrNull(row.get('WorkItemID')));
      const periodId = resolve(ctx, '_DB_PERIOD', textOrNull(row.get('PeriodID')));
      const entryDate = excelSerialToDay(row.get('ProgressDate'));
      const qty = decimalOrNull(row.get('QtyThisEntry'));

      if (
        sourceId === null ||
        projectId === null ||
        workItemId === null ||
        periodId === null ||
        entryDate === null ||
        qty === null
      ) {
        unresolved += 1;
        result.skipped += 1;
        continue;
      }

      /*
       * The share of the item this entry represents. The workbook records the
       * quantity; this application records both, and the percentage is what
       * every weight and curve reads. Derived here rather than left to the
       * caller so the two can never disagree.
       */
      const volume = Number(volumeOf.get(workItemId) ?? '0');
      const pct = volume > 0 ? (Number(qty) / volume).toFixed(6) : '0';

      const values = {
        entryDate,
        qtyThisPeriod: qty,
        pctThisPeriod: pct,
        method: 'VOLUME' as const,
        /*
         * Imported entries arrive approved. They are history: the workbook has
         * already been used to bill from, and importing them as drafts would
         * make a finished project look as though nothing had been agreed.
         */
        status: 'APPROVED' as const,
        location: textOrNull(row.get('Location')),
        note: textOrNull(row.get('Notes')),
        updatedBy: ctx.userId,
      };

      const natural = `${workItemId} ${periodId}`;
      const existingId = resolve(ctx, '_DB_PROGRESS', sourceId) ?? byKey.get(natural) ?? null;
      const id = existingId ?? randomUUID();

      queue.push({ ...values, id, projectId, workItemId, periodId, createdBy: ctx.userId });
      byKey.set(natural, id);
      remember(ctx, '_DB_PROGRESS', sourceId, 'progress_entries', id);
      if (existingId === null) result.created += 1;
      else result.updated += 1;
    }

    await writeChunks(ctx.tx, progressEntries, queue, [
      'entryDate',
      'qtyThisPeriod',
      'pctThisPeriod',
      'method',
      'status',
      'location',
      'note',
      'updatedBy',
    ]);

    if (unresolved > 0) {
      result.issues.push(
        `${unresolved} entri progres dilewati karena pekerjaan, periode, atau tanggalnya tidak terselesaikan.`,
      );
    }
  },
};

const DEPENDENCY_TYPES = new Set(['FS', 'SS', 'FF', 'SF']);

/**
 * When each item is planned to run.
 *
 * These dates are the plan, not a record of what happened — that is what the
 * progress entries are. Imported so the schedule screen opens on the plan the
 * workbook already held, rather than on an empty calendar somebody would have
 * to retype out of it.
 */
const scheduleStep: Step = {
  sheet: '_DB_SCHEDULE',
  label: 'Jadwal item',
  async run(rows, ctx, result) {
    const itemIds = importedWorkItemIds(ctx);
    const existing =
      itemIds.length === 0
        ? []
        : await ctx.tx
            .select({ id: workItemSchedules.id, workItemId: workItemSchedules.workItemId })
            .from(workItemSchedules)
            .where(inArray(workItemSchedules.workItemId, itemIds));
    const byItem = new Map(existing.map((r) => [r.workItemId, r.id]));
    const queue: InferInsertModel<typeof workItemSchedules>[] = [];

    let unresolved = 0;
    let backwards = 0;
    let selfDependent = 0;

    for (const row of rows) {
      const sourceId = textOrNull(row.get('ScheduleID'));
      const workItemId = resolve(ctx, '_DB_WORKITEM', textOrNull(row.get('WorkItemID')));
      if (sourceId === null || workItemId === null) {
        unresolved += 1;
        result.skipped += 1;
        continue;
      }

      const plannedStart = excelSerialToDay(row.get('StartDate'));
      const plannedFinish = excelSerialToDay(row.get('FinishDate'));
      // The table refuses a finish before its start, and rightly. A pair that
      // says otherwise is a typo, and importing half of it would be a guess.
      if (plannedStart !== null && plannedFinish !== null && plannedFinish < plannedStart) {
        backwards += 1;
        result.skipped += 1;
        continue;
      }

      // An item waiting for itself can never start, and the table has a
      // constraint saying so. Dropping the dependency keeps the dates.
      let predecessorId = resolve(ctx, '_DB_WORKITEM', textOrNull(row.get('PredecessorItemID')));
      if (predecessorId === workItemId) {
        predecessorId = null;
        selfDependent += 1;
      }

      const dependency = (textOrNull(row.get('DependencyType')) ?? 'FS').toUpperCase();
      const duration = Number(textOrNull(row.get('DurationDays')) ?? '');

      const values = {
        plannedStart,
        plannedFinish,
        durationDays: Number.isFinite(duration) && duration >= 0 ? Math.round(duration) : null,
        predecessorId,
        dependencyType: (DEPENDENCY_TYPES.has(dependency) ? dependency : 'FS') as 'FS',
        lagDays: Number(textOrNull(row.get('LagDays')) ?? '0') || 0,
        updatedBy: ctx.userId,
      };

      const existingId = resolve(ctx, '_DB_SCHEDULE', sourceId) ?? byItem.get(workItemId) ?? null;
      const id = existingId ?? randomUUID();

      queue.push({ ...values, id, workItemId, createdBy: ctx.userId });
      byItem.set(workItemId, id);
      remember(ctx, '_DB_SCHEDULE', sourceId, 'work_item_schedules', id);
      if (existingId === null) result.created += 1;
      else result.updated += 1;
    }

    await writeChunks(ctx.tx, workItemSchedules, queue, [
      'plannedStart',
      'plannedFinish',
      'durationDays',
      'predecessorId',
      'dependencyType',
      'lagDays',
      'updatedBy',
    ]);

    if (unresolved > 0) {
      result.issues.push(
        `${unresolved} baris jadwal dilewati karena item pekerjaannya tidak terimpor.`,
      );
    }
    if (backwards > 0) {
      result.issues.push(
        `${backwards} baris jadwal dilewati karena tanggal selesainya mendahului tanggal mulai.`,
      );
    }
    if (selfDependent > 0) {
      result.issues.push(
        `${selfDependent} item tercatat menunggu dirinya sendiri; ketergantungan itu dilepas, tanggalnya tetap diimpor.`,
      );
    }
  },
};

/**
 * How much of each item is planned in each period — the plan curve itself.
 *
 * The workbook states a quantity; this application states a share of the item,
 * because that is what every weight and every S-curve reads. The share is
 * derived here from the item's own volume rather than taken from the
 * workbook's PlannedWeightPct, which is a share of the whole project and
 * cannot be converted back unless the project total agrees to the rupiah.
 */
const planPhasingStep: Step = {
  sheet: '_DB_PLANPHASING',
  label: 'Rencana per periode',
  async run(rows, ctx, result) {
    const itemIds = importedWorkItemIds(ctx);
    const volumes =
      itemIds.length === 0
        ? []
        : await ctx.tx
            .select({ id: workItems.id, volume: workItems.volume })
            .from(workItems)
            .where(inArray(workItems.id, itemIds));
    const volumeOf = new Map(volumes.map((r) => [r.id, r.volume]));

    const existing =
      itemIds.length === 0
        ? []
        : await ctx.tx
            .select({
              id: plannedDistributions.id,
              workItemId: plannedDistributions.workItemId,
              periodId: plannedDistributions.periodId,
            })
            .from(plannedDistributions)
            .where(inArray(plannedDistributions.workItemId, itemIds));
    const byKey = new Map(existing.map((r) => [`${r.workItemId} ${r.periodId}`, r.id]));
    const queue: InferInsertModel<typeof plannedDistributions>[] = [];

    let unresolved = 0;
    let clamped = 0;

    for (const row of rows) {
      const sourceId = textOrNull(row.get('PhaseID'));
      const workItemId = resolve(ctx, '_DB_WORKITEM', textOrNull(row.get('WorkItemID')));
      const periodId = resolve(ctx, '_DB_PERIOD', textOrNull(row.get('PeriodID')));
      const qty = decimalOrNull(row.get('PlannedQty'));

      if (sourceId === null || workItemId === null || periodId === null || qty === null) {
        unresolved += 1;
        result.skipped += 1;
        continue;
      }

      const volume = Number(volumeOf.get(workItemId) ?? '0');
      const raw = volume > 0 ? Number(qty) / volume : 0;
      /*
       * The column holds a share between nought and one, and the workbook can
       * plan more of an item than the item has — a volume corrected downwards
       * after the plan was drawn. Clamping keeps the plan importable, and the
       * count reports how often it happened, which is the signal that a volume
       * wants looking at.
       */
      if (raw < 0 || raw > 1) clamped += 1;
      const plannedPct = Math.min(Math.max(raw, 0), 1).toFixed(6);

      const natural = `${workItemId} ${periodId}`;
      const existingId = resolve(ctx, '_DB_PLANPHASING', sourceId) ?? byKey.get(natural) ?? null;
      const id = existingId ?? randomUUID();

      queue.push({
        id,
        workItemId,
        periodId,
        plannedPct,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      });
      byKey.set(natural, id);
      remember(ctx, '_DB_PLANPHASING', sourceId, 'planned_distributions', id);
      if (existingId === null) result.created += 1;
      else result.updated += 1;
    }

    await writeChunks(ctx.tx, plannedDistributions, queue, ['plannedPct', 'updatedBy']);

    if (unresolved > 0) {
      result.issues.push(
        `${unresolved} baris rencana dilewati karena item pekerjaan atau periodenya tidak terimpor.`,
      );
    }
    if (clamped > 0) {
      result.issues.push(
        `${clamped} baris rencana melebihi volume itemnya dan dipotong ke 100%. ` +
          'Biasanya itu berarti volume item sudah berubah setelah rencana dibuat.',
      );
    }
  },
};

/*
 * The order data depends on. Every step resolves its parents through
 * `import_refs`, so a step can only run once the things it points at are
 * there — which is what this list encodes.
 */
const STEPS: Step[] = [
  unitStep,
  resourceStep,
  supplierStep,
  foremanStep,
  projectStep,
  priceStep,
  workGroupStep,
  workItemStep,
  workItemResourceStep,
  periodStep,
  scheduleStep,
  planPhasingStep,
  progressStep,
];

class DryRunRollback extends Error {
  constructor(readonly report: WorkbookImportReport) {
    super('dry run');
    this.name = 'DryRunRollback';
  }
}

const CHUNK = 500;

export async function importWorkbook(
  user: SessionUser,
  workbook: ExcelJS.Workbook,
  options: { source: string; dryRun?: boolean } = { source: 'PROJECT_CONTROL' },
): Promise<WorkbookImportReport> {
  const access = await assertOrgAccess(user.id, 'ADMIN');
  const dryRun = options.dryRun ?? false;
  const batch = new Date().toISOString().slice(0, 19) + 'Z';

  const report: WorkbookImportReport = {
    batch,
    source: options.source,
    dryRun,
    steps: [],
    totals: { created: 0, updated: 0, skipped: 0 },
  };

  try {
    await withUser(user.id, async (tx) => {
      const known = await tx
        .select({
          sourceTable: importRefs.sourceTable,
          sourceId: importRefs.sourceId,
          targetId: importRefs.targetId,
        })
        .from(importRefs)
        .where(and(eq(importRefs.orgId, access.orgId), eq(importRefs.source, options.source)));

      const ctx: Ctx = {
        tx,
        orgId: access.orgId,
        userId: user.id,
        source: options.source,
        batch,
        refs: new Map(known.map((row) => [refKey(row.sourceTable, row.sourceId), row.targetId])),
        pending: [],
      };

      for (const step of STEPS) {
        const { rows, issues } = readTable(workbook, step.sheet);

        /*
         * Deleted rows are dropped here rather than inside each step, so that
         * every line of the report adds up: read is what the step was given,
         * and created + updated + skipped accounts for all of it. A step that
         * silently swallowed twenty rows of its own is how an import comes to
         * be trusted for something it never did.
         */
        const live = rows.filter(isLiveRow);
        const result: StepResult = {
          sheet: step.sheet,
          label: step.label,
          read: live.length,
          deleted: rows.length - live.length,
          created: 0,
          updated: 0,
          skipped: 0,
          issues: issues.map((i) => i.message),
        };

        if (live.length > 0) await step.run(live, ctx, result);

        report.steps.push(result);
        report.totals.created += result.created;
        report.totals.updated += result.updated;
        report.totals.skipped += result.skipped;
      }

      /*
       * The correlation rows go in last, in bulk. Written per row they would
       * double the round trips of the whole import, and they are only useful
       * once the transaction they describe has committed.
       *
       * Deduplicated by key first: a step may remember the same source row
       * twice within one run, and a batch carrying the same key twice is
       * rejected wholesale by the unique index. Rows already known are written
       * again on purpose — the conflict clause refreshes when they were last
       * seen, which is how "this project has stopped appearing in the workbook"
       * becomes visible.
       */
      const unique = new Map(
        ctx.pending.map((entry) => [refKey(entry.sourceTable, entry.sourceId), entry]),
      );
      const fresh = [...unique.values()];

      for (let i = 0; i < fresh.length; i += CHUNK) {
        await tx
          .insert(importRefs)
          .values(
            fresh.slice(i, i + CHUNK).map((entry) => ({
              orgId: access.orgId,
              source: options.source,
              sourceTable: entry.sourceTable,
              sourceId: entry.sourceId,
              targetTable: entry.targetTable,
              targetId: entry.targetId,
              lastBatch: batch,
            })),
          )
          .onConflictDoUpdate({
            target: [importRefs.orgId, importRefs.source, importRefs.sourceTable, importRefs.sourceId],
            set: { lastImportedAt: sql`now()`, lastBatch: batch },
          });
      }

      await writeAuditLog(tx, {
        orgId: access.orgId,
        tableName: 'import_refs',
        recordId: null,
        action: 'INSERT',
        before: null,
        after: { batch, source: options.source, ...report.totals },
        actorId: user.id,
      });

      if (dryRun) throw new DryRunRollback(report);
    });
  } catch (error) {
    if (error instanceof DryRunRollback) return error.report;
    throw error;
  }

  return report;
}

/** Where a row here came from, for a screen that wants to say so. */
export async function findImportSource(
  userId: string,
  targetTable: string,
  targetId: string,
): Promise<{ source: string; sourceTable: string; sourceId: string } | null> {
  const access = await assertOrgAccess(userId);

  const [row] = await withUser(userId, (tx) =>
    tx
      .select({
        source: importRefs.source,
        sourceTable: importRefs.sourceTable,
        sourceId: importRefs.sourceId,
      })
      .from(importRefs)
      .where(
        and(
          eq(importRefs.orgId, access.orgId),
          eq(importRefs.targetTable, targetTable),
          eq(importRefs.targetId, targetId),
        ),
      )
      .limit(1),
  );

  return row ?? null;
}
