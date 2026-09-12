import { randomUUID } from 'node:crypto';

import { config as loadEnv } from 'dotenv';
import ExcelJS from 'exceljs';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { connectionOptions } from '@/db/connection';
import type { importWorkbook as ImportWorkbookFn } from '../import-workbook';
import { guardDatabase, probeSchema } from './_support/schema-probe';

/**
 * Persistence tests for the PROJECT_CONTROL workbook import.
 *
 * Everything worth testing here is a property of the write path against a real
 * database: whether the correlation actually correlates on a second run,
 * whether a workbook that repeats a key survives the unique indexes, and
 * whether the projects it creates are visible to the person who created them —
 * the last of which is row-level security, and cannot be tested any other way.
 * Skips itself when no database is reachable.
 */

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ path: '.env', quiet: true });

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

const probe = await probeSchema('impor workbook', async (db) => {
  const rows = await db`
    SELECT count(*)::int AS n FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('import_refs', 'projects', 'work_items', 'work_item_resources')
  `;
  return rows[0]?.n === 4;
});

guardDatabase('impor workbook', probe);
const ready = probe.ready;

type Sheet = { name: string; header: string[]; rows: (string | number | null)[][] };

function build(sheets: Sheet[]): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    const ws = workbook.addWorksheet(sheet.name);
    ws.addRow(sheet.header);
    for (const row of sheet.rows) ws.addRow(row);
  }
  return workbook;
}

/**
 * The smallest workbook that exercises every kind of link: a unit a resource
 * points at, a project a work item hangs off, and an AHSP line joining the two.
 */
function fixture(
  overrides: { projectName?: string; extraSheets?: Sheet[]; wbsRows?: (string | number | null)[][] } = {},
): ExcelJS.Workbook {
  return build([
    {
      name: '_DB_UNIT',
      header: ['UnitCode', 'UnitName', 'UnitType', 'RowStatus'],
      rows: [
        ['m3', 'Meter kubik', 'VOLUME', 'ACTIVE'],
        ['OH', 'Orang hari', 'TIME', 'ACTIVE'],
      ],
    },
    {
      name: '_DB_RESOURCE',
      header: ['ResourceID', 'ResourceCode', 'ResourceName', 'Category', 'Unit', 'RowStatus'],
      rows: [
        ['RES-001', 'L.01', 'Pekerja', 'LABOR', 'OH', 'ACTIVE'],
        ['RES-002', 'M.01', 'Pasir', 'MATERIAL', 'm3', 'ACTIVE'],
      ],
    },
    {
      name: '_DB_PROJECT',
      header: [
        'ProjectID', 'ProjectCode', 'ProjectName', 'Location',
        'ContractValue', 'StartDate', 'FinishDate', 'RowStatus',
      ],
      rows: [
        [
          'PRJ-001', 'UJI-WB-001', overrides.projectName ?? 'Proyek Uji Workbook',
          'Purworejo', 1_000_000, 46_000, 46_100, 'ACTIVE',
        ],
      ],
    },
    {
      name: '_DB_WBS',
      header: ['WbsID', 'ProjectID', 'WbsCode', 'WbsName', 'SortOrder', 'RowStatus'],
      rows: overrides.wbsRows ?? [['WBS-001', 'PRJ-001', 'A', 'Pekerjaan Persiapan', 1, 'ACTIVE']],
    },
    {
      name: '_DB_WORKITEM',
      header: [
        'WorkItemID', 'ProjectID', 'WbsID', 'ItemCode', 'Description',
        'Unit', 'Volume', 'SortOrder', 'RowStatus',
      ],
      rows: [['WIT-001', 'PRJ-001', 'WBS-001', 'A.1', 'Galian tanah', 'm3', 100, 1, 'ACTIVE']],
    },
    {
      name: '_DB_WORKITEMRESOURCE',
      header: ['WirID', 'WorkItemID', 'ResourceID', 'Coefficient', 'SortOrder', 'RowStatus'],
      rows: [
        ['WIR-001', 'WIT-001', 'RES-001', 0.75, 1, 'ACTIVE'],
        ['WIR-002', 'WIT-001', 'RES-002', 1.2, 2, 'ACTIVE'],
      ],
    },
    ...(overrides.extraSheets ?? []),
  ]);
}

const step = (report: { steps: { sheet: string; read: number; created: number; updated: number; skipped: number; deleted: number }[] }, sheet: string) => {
  const found = report.steps.find((s) => s.sheet === sheet);
  if (!found) throw new Error(`langkah ${sheet} tidak ada dalam laporan`);
  return found;
};

describe.skipIf(!ready)('impor workbook — lapisan penyimpanan', () => {
  let sql: postgres.Sql;
  // Imported lazily inside beforeAll so the module — and its database pool —
  // is never constructed when the suite is skipped.
  let importWorkbook: typeof ImportWorkbookFn;

  const orgId = randomUUID();
  const userId = randomUUID();
  const actor = {
    id: userId,
    orgId,
    email: `wb-${userId}@uji.test`,
    fullName: 'Penguji Workbook',
    globalRole: 'ADMIN' as const,
  };

  const counts = async () => {
    const [row] = await sql`
      SELECT
        (SELECT count(*)::int FROM projects WHERE org_id = ${orgId})                    AS projects,
        (SELECT count(*)::int FROM work_groups g
           JOIN projects p ON p.id = g.project_id WHERE p.org_id = ${orgId})            AS groups,
        (SELECT count(*)::int FROM work_items i
           JOIN projects p ON p.id = i.project_id WHERE p.org_id = ${orgId})            AS items,
        (SELECT count(*)::int FROM work_item_resources r
           JOIN work_items i ON i.id = r.work_item_id
           JOIN projects p ON p.id = i.project_id WHERE p.org_id = ${orgId})            AS lines,
        (SELECT count(*)::int FROM resources WHERE org_id = ${orgId})                   AS resources,
        (SELECT count(*)::int FROM units WHERE org_id = ${orgId})                       AS units,
        (SELECT count(*)::int FROM import_refs WHERE org_id = ${orgId})                 AS refs
    `;
    return row as Record<string, number>;
  };

  const clean = async (tx: postgres.TransactionSql) => {
    await tx`SELECT set_config('app.bypass_rls', 'on', true)`;
    await tx`DELETE FROM import_refs WHERE org_id = ${orgId}`;
    await tx`DELETE FROM projects WHERE org_id = ${orgId}`;
    await tx`DELETE FROM resources WHERE org_id = ${orgId}`;
    await tx`DELETE FROM units WHERE org_id = ${orgId}`;
    await tx`DELETE FROM users WHERE org_id = ${orgId}`;
    await tx`DELETE FROM organizations WHERE id = ${orgId}`;
  };

  beforeAll(async () => {
    sql = postgres(connectionOptions(url!, { max: 1, prepare: false, onnotice: () => {} }));
    ({ importWorkbook } = await import('../import-workbook'));
  });

  beforeEach(async () => {
    await sql.begin(async (tx) => {
      await clean(tx);
      await tx`INSERT INTO organizations (id, name) VALUES (${orgId}, 'Org Workbook (uji)')`;
      await tx`
        INSERT INTO users (id, org_id, email, full_name, global_role)
        VALUES (${userId}, ${orgId}, ${actor.email}, ${actor.fullName}, 'ADMIN')
      `;
    });
  });

  afterAll(async () => {
    if (!sql) return;
    await sql.begin(clean);
    await sql.end();
  });

  it('membawa masuk satuan, sumber daya, proyek, dan AHSP-nya', async () => {
    const report = await importWorkbook(actor, fixture(), { source: 'UJI' });

    expect(report.dryRun).toBe(false);
    expect(step(report, '_DB_PROJECT').created).toBe(1);
    expect(step(report, '_DB_WORKITEM').created).toBe(1);
    // One workbook line becomes two: the RAB analysis and the RAP analysis.
    expect(step(report, '_DB_WORKITEMRESOURCE').created).toBe(4);

    expect(await counts()).toMatchObject({
      projects: 1,
      groups: 1,
      items: 1,
      lines: 4,
      resources: 2,
      units: 2,
    });
  });

  // The report is only worth reading if its arithmetic holds.
  it('setiap langkah melaporkan angka yang berjumlah benar', async () => {
    const report = await importWorkbook(actor, fixture(), { source: 'UJI' });

    for (const s of report.steps) {
      /*
       * One exception, and it is deliberate: an AHSP line in the workbook is
       * written to both the RAB and the RAP analysis, so that step reports
       * twice as many rows written as it read. Every other step accounts for
       * each row it was given exactly once.
       */
      const expected = s.sheet === '_DB_WORKITEMRESOURCE' ? s.read * 2 - s.skipped : s.read;

      expect(
        { sheet: s.sheet, total: s.created + s.updated + s.skipped },
        `langkah ${s.sheet}`,
      ).toEqual({ sheet: s.sheet, total: expected });
    }
  });

  it('uji coba tidak meninggalkan apa pun', async () => {
    const report = await importWorkbook(actor, fixture(), { source: 'UJI', dryRun: true });

    expect(report.dryRun).toBe(true);
    expect(step(report, '_DB_PROJECT').created).toBe(1);
    expect(await counts()).toMatchObject({ projects: 0, items: 0, lines: 0, refs: 0 });
  });

  it('mengimpor ulang memperbarui baris yang sama, bukan menggandakannya', async () => {
    await importWorkbook(actor, fixture(), { source: 'UJI' });
    const before = await counts();

    const second = await importWorkbook(actor, fixture({ projectName: 'Nama Baru' }), {
      source: 'UJI',
    });

    expect(step(second, '_DB_PROJECT')).toMatchObject({ created: 0, updated: 1 });
    expect(step(second, '_DB_WORKITEMRESOURCE')).toMatchObject({ created: 0, updated: 4 });
    expect(await counts()).toEqual(before);

    const [project] = await sql`
      SELECT name FROM projects WHERE org_id = ${orgId}
    `;
    expect(project?.name).toBe('Nama Baru');
  });

  /*
   * The workbook is edited by hand, and a row renumbered rather than corrected
   * leaves two rows describing one thing. The natural key is what catches it;
   * without that this import fails outright on a unique index.
   */
  it('dua baris workbook dengan kunci alami sama menjadi satu baris', async () => {
    const report = await importWorkbook(
      actor,
      fixture({
        wbsRows: [
          ['WBS-001', 'PRJ-001', 'A', 'Pekerjaan Persiapan', 1, 'ACTIVE'],
          ['WBS-002', 'PRJ-001', 'A', 'Persiapan (revisi)', 1, 'ACTIVE'],
        ],
      }),
      { source: 'UJI' },
    );

    expect(step(report, '_DB_WBS')).toMatchObject({ read: 2, created: 1, updated: 1 });
    expect(await counts()).toMatchObject({ groups: 1 });

    // The later row wins, which is what writing them one after another would do.
    const [group] = await sql`
      SELECT g.name FROM work_groups g JOIN projects p ON p.id = g.project_id
      WHERE p.org_id = ${orgId}
    `;
    expect(group?.name).toBe('Persiapan (revisi)');
  });

  it('baris yang ditandai terhapus di workbook tidak dibaca', async () => {
    const report = await importWorkbook(
      actor,
      fixture({
        wbsRows: [
          ['WBS-001', 'PRJ-001', 'A', 'Pekerjaan Persiapan', 1, 'ACTIVE'],
          ['WBS-009', 'PRJ-001', 'Z', 'Sudah dihapus', 9, 'DELETED'],
        ],
      }),
      { source: 'UJI' },
    );

    expect(step(report, '_DB_WBS')).toMatchObject({ read: 1, deleted: 1, created: 1 });
    expect(await counts()).toMatchObject({ groups: 1 });
  });

  /*
   * Row-level security reads projects through membership. An import that
   * wrote a project nobody belonged to would appear to succeed and then be
   * invisible to the person who ran it — including to the next import.
   */
  it('proyek yang diimpor terlihat oleh yang mengimpornya', async () => {
    await importWorkbook(actor, fixture(), { source: 'UJI' });

    const visible = await sql.begin(async (tx) => {
      await tx`SELECT set_config('role', 'app_runtime', true),
                      set_config('app.current_user_id', ${userId}, true)`;
      return tx`SELECT code FROM projects`;
    });

    expect(visible.map((r) => r.code)).toContain('UJI-WB-001');
  });

  it('dua sumber berbeda tidak saling menimpa meski kodenya sama', async () => {
    await importWorkbook(actor, fixture(), { source: 'SATU' });
    const second = await importWorkbook(actor, fixture({ projectName: 'Proyek Lain' }), {
      source: 'DUA',
    });

    /*
     * Same project code, so the second source adopts the project rather than
     * creating a second one — but it records its own correlation row, which is
     * what keeps the two sources from being confused for one another later.
     */
    expect(step(second, '_DB_PROJECT')).toMatchObject({ created: 0, updated: 1 });
    expect(await counts()).toMatchObject({ projects: 1 });

    const [row] = await sql`
      SELECT count(*)::int AS n FROM import_refs
      WHERE org_id = ${orgId} AND source_table = '_DB_PROJECT'
    `;
    expect(row?.n).toBe(2);
  });
});
