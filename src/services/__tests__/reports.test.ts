import { randomUUID } from 'node:crypto';

import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { connectionOptions } from '@/db/connection';
import type * as ProgressModule from '../progress';
import type * as ReportsModule from '../reports';
import type * as ScheduleModule from '../schedule';
import type { SessionUser } from '../session';
import { guardDatabase, probeSchema } from './_support/schema-probe';

/**
 * Phase 9's definition of done: a published report keeps saying what it said.
 *
 * Everything else here is a detail; this is the property the snapshot exists
 * for, so it is tested by publishing, then moving the underlying data, then
 * reading the report back.
 */

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ path: '.env', quiet: true });

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

const probe = await probeSchema('Laporan', async (db) => {
  const rows = await db`
    SELECT count(*)::int AS n FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN ('report_snapshots', 'issues')
  `;
  return rows[0]?.n === 2;
});

// A configured database that cannot be reached is a failure, not a skip:
// a suite that verified nothing must not look as though it had.
guardDatabase('Laporan', probe);
const ready = probe.ready;

describe.skipIf(!ready)('Laporan terbit', () => {
  let sql: postgres.Sql;
  let reports: typeof ReportsModule;
  let progress: typeof ProgressModule;
  let schedule: typeof ScheduleModule;

  const orgId = randomUUID();
  const userId = randomUUID();
  const projectId = randomUUID();
  const unitId = randomUUID();
  const itemId = randomUUID();

  const user: SessionUser = {
    id: userId,
    orgId,
    email: `lap-${userId}@uji.test`,
    fullName: 'Pelapor Uji',
    globalRole: 'ADMIN',
  };

  const buildFixture = async (): Promise<void> => {
    await sql.unsafe(`
      BEGIN;
      SELECT set_config('app.bypass_rls', 'on', true);
      SELECT set_config('app.allow_hard_delete', 'on', true);
      DELETE FROM projects WHERE org_id = '${orgId}';
      DELETE FROM units WHERE org_id = '${orgId}';
      DELETE FROM users WHERE org_id = '${orgId}';
      DELETE FROM organizations WHERE id = '${orgId}';

      INSERT INTO organizations (id, name) VALUES ('${orgId}', 'Org Laporan (uji)');
      INSERT INTO users (id, org_id, email, full_name, global_role)
        VALUES ('${userId}', '${orgId}', '${user.email}', '${user.fullName}', 'ADMIN');
      INSERT INTO projects (id, org_id, code, name, start_date, end_date, period_type,
                            contract_value, require_checklist_before_approve)
        VALUES ('${projectId}', '${orgId}', 'LAP-1', 'Proyek Laporan',
                '2026-01-01', '2026-03-31', 'MONTH', 100000000, false);
      INSERT INTO project_members (project_id, user_id, role)
        VALUES ('${projectId}', '${userId}', 'PROJECT_MANAGER');
      INSERT INTO units (id, org_id, code, name, dimension, factor_to_base)
        VALUES ('${unitId}', '${orgId}', 'ls', 'Lumpsum', 'LUMPSUM', 1);
      INSERT INTO work_items (id, project_id, code, name, unit_id, volume,
                              contract_unit_price, include_in_progress_weight, progress_method)
        VALUES ('${itemId}', '${projectId}', 'A.01', 'Struktur', '${unitId}', 1, 100000000, true, 'PERCENT');
      COMMIT;
    `).simple();
  };

  const periodIds = async (): Promise<string[]> => {
    const rows = await sql<{ id: string }[]>`
      SELECT id FROM schedule_periods WHERE project_id = ${projectId} ORDER BY seq
    `;
    return rows.map((r) => r.id);
  };

  /** Records and approves a figure so it lands in the realised curve. */
  const approveProgress = async (periodId: string, pct: string): Promise<void> => {
    await progress.saveProgressEntry(user, projectId, itemId, periodId, {
      method: 'PERCENT',
      qtyThisPeriod: null,
      pctThisPeriod: pct,
      entryDate: '2026-01-31',
      location: null,
      note: null,
    });
    const [entry] = await progress.listEntriesForPeriod(userId, projectId, periodId);
    await progress.submitProgressEntry(user, projectId, entry!.id);
    await progress.approveProgressEntry(user, projectId, entry!.id);
  };

  beforeAll(async () => {
    sql = postgres(connectionOptions(url!, { max: 1, prepare: false, onnotice: () => {} }));
    [reports, progress, schedule] = await Promise.all([
      import('../reports'),
      import('../progress'),
      import('../schedule'),
    ]);
  });

  beforeEach(async () => {
    await buildFixture();
    await schedule.regeneratePeriods(user, projectId);
  });

  afterAll(async () => {
    if (!sql) return;
    await sql.unsafe(`
      BEGIN;
      SELECT set_config('app.bypass_rls', 'on', true);
      SELECT set_config('app.allow_hard_delete', 'on', true);
      DELETE FROM projects WHERE org_id = '${orgId}';
      DELETE FROM units WHERE org_id = '${orgId}';
      DELETE FROM users WHERE org_id = '${orgId}';
      DELETE FROM organizations WHERE id = '${orgId}';
      COMMIT;
    `).simple();
    await sql.end();
  });

  describe('menyusun isi laporan', () => {
    it('memuat capaian periode yang dipilih', async () => {
      const [p1] = await periodIds();
      await approveProgress(p1!, '0.4');

      const payload = await reports.buildReportPayload(userId, projectId, p1!, 'DAILY');

      expect(payload.project.code).toBe('LAP-1');
      expect(payload.period.id).toBe(p1);
      expect(Number(payload.physical.actualCumulative)).toBeCloseTo(0.4, 9);
      expect(payload.items).toHaveLength(1);
      expect(Number(payload.items[0]?.pctThisPeriod)).toBeCloseTo(0.4, 9);
    });

    /*
     * A published report travels with the invoice. RAP is the contractor's own
     * execution budget, so printing it there hands the owner the cost structure
     * and the margin on it. Asserted against the serialised payload rather than
     * the typed shape, because the leak that matters is whatever ends up in the
     * database and on paper.
     */
    it('tidak memuat satu pun angka biaya internal', async () => {
      const [p1] = await periodIds();

      for (const type of ['DAILY', 'WEEKLY', 'MONTHLY'] as const) {
        const payload = await reports.buildReportPayload(userId, projectId, p1!, type);
        const serialised = JSON.stringify(payload);

        for (const forbidden of [
          'totalRap',
          'actualCost',
          'costVariance',
          'marginProjected',
          'cpi',
          'inflow',
          'outflow',
        ]) {
          expect(serialised, `${type} membocorkan ${forbidden}`).not.toContain(forbidden);
        }
      }
    });

    it('melampirkan kurva-S pada laporan mingguan dan bulanan', async () => {
      const [p1, p2] = await periodIds();
      await approveProgress(p1!, '0.4');

      for (const type of ['WEEKLY', 'MONTHLY'] as const) {
        const payload = await reports.buildReportPayload(userId, projectId, p2!, type);
        expect(payload.curve, type).not.toBeNull();
        // Sampai periode pelaporan saja, tidak sampai akhir proyek.
        expect(payload.curve).toHaveLength(2);
        expect(Number(payload.curve?.[0]?.actualCumulative)).toBeCloseTo(0.4, 9);
      }
    });

    // One day of an S-curve is a dot; the shape only reads over weeks.
    it('tidak melampirkan kurva-S pada laporan harian', async () => {
      const [p1] = await periodIds();
      const payload = await reports.buildReportPayload(userId, projectId, p1!, 'DAILY');
      expect(payload.curve).toBeNull();
    });

    it('memuat kolom bobot periode lalu, periode ini, dan kumulatifnya', async () => {
      const [p1, p2] = await periodIds();
      await approveProgress(p1!, '0.4');
      await approveProgress(p2!, '0.3');

      const payload = await reports.buildReportPayload(userId, projectId, p2!, 'WEEKLY');
      const item = payload.items.find((row) => row.code === 'A.01');

      expect(Number(item?.weighted?.previous)).toBeCloseTo(0.4, 9);
      expect(Number(item?.weighted?.current)).toBeCloseTo(0.3, 9);
      expect(Number(item?.weighted?.cumulative)).toBeCloseTo(0.7, 9);
      expect(item?.weighted?.deviation).toBeDefined();
      expect(payload.periodType).toBeDefined();
    });

    /*
     * The recap has to reconcile with the headline two sections above it, or
     * the reader is left holding two different answers to the same question.
     */
    it('menjumlah kolom kumulatif persis sebesar kemajuan fisiknya', async () => {
      const [p1, p2] = await periodIds();
      await approveProgress(p1!, '0.4');
      await approveProgress(p2!, '0.3');

      const payload = await reports.buildReportPayload(userId, projectId, p2!, 'MONTHLY');
      const total = payload.items.reduce(
        (acc, item) => acc + Number(item.weighted?.cumulative ?? 0),
        0,
      );

      expect(total).toBeCloseTo(Number(payload.physical.actualCumulative), 9);
    });

    /*
     * A daily sheet is a record of one day's work; a weekly or monthly report
     * is a recap of the whole scope, which is what makes its weight column add
     * up to the project.
     */
    it('merekap seluruh lingkup pada laporan mingguan, hanya yang dicatat pada harian', async () => {
      const [p1] = await periodIds();
      await approveProgress(p1!, '0.4');

      const daily = await reports.buildReportPayload(userId, projectId, p1!, 'DAILY');
      const weekly = await reports.buildReportPayload(userId, projectId, p1!, 'WEEKLY');

      expect(daily.items.every((item) => item.status !== null)).toBe(true);
      expect(weekly.items.length).toBeGreaterThanOrEqual(daily.items.length);
    });

    /*
     * The photo plates group by work item id. Matching by name instead would
     * file a photograph under the wrong work item whenever two share a name —
     * on a printed report handed to an owner, that is a false claim.
     */
    it('membawa id pekerjaan agar foto dapat dikelompokkan', async () => {
      const [p1] = await periodIds();
      await approveProgress(p1!, '0.4');

      for (const type of ['DAILY', 'WEEKLY', 'MONTHLY'] as const) {
        const payload = await reports.buildReportPayload(userId, projectId, p1!, type);
        expect(payload.items.length).toBeGreaterThan(0);
        expect(
          payload.items.every((item) => typeof item.workItemId === 'string'),
          `${type} kehilangan id pekerjaan`,
        ).toBe(true);
      }
    });

    it('membawa kendala periode itu', async () => {
      const [p1] = await periodIds();
      await reports.saveIssue(user, projectId, null, {
        title: 'Hujan tiga hari',
        description: 'Pengecoran tertunda',
        severity: 'HIGH',
        status: 'OPEN',
        periodId: p1!,
      });

      const payload = await reports.buildReportPayload(userId, projectId, p1!, 'WEEKLY');

      expect(payload.issues).toHaveLength(1);
      expect(payload.issues[0]).toMatchObject({ title: 'Hujan tiga hari', severity: 'HIGH' });
    });

    it('menolak periode milik proyek lain', async () => {
      await expect(
        reports.buildReportPayload(userId, projectId, randomUUID(), 'DAILY'),
      ).rejects.toThrow(/tidak dikenal/);
    });
  });

  describe('pembekuan', () => {
    /*
     * The whole reason snapshots exist. A report handed over in January must
     * still read the same in March, after the underlying figures have moved.
     */
    it('tetap menampilkan angka saat diterbitkan meski data berubah', async () => {
      const [p1, p2] = await periodIds();
      await approveProgress(p1!, '0.4');

      /*
       * Published for period 2 while period 2 itself is still empty, so its
       * cumulative is the 0,4 carried over from January. Approving work in
       * period 2 afterwards is what moves the live figure — publishing for
       * period 1 instead would leave both numbers at 0,4 and prove nothing.
       */
      const published = await reports.publishReport(user, projectId, p2!, 'MONTHLY');
      expect(
        Number((await reports.getSnapshot(userId, projectId, published.id)).payload.physical.actualCumulative),
      ).toBeCloseTo(0.4, 9);

      await approveProgress(p2!, '0.3');

      const live = await reports.buildReportPayload(userId, projectId, p2!, 'WEEKLY');
      const reopened = await reports.getSnapshot(userId, projectId, published.id);

      // The live figure has moved…
      expect(Number(live.physical.actualCumulative)).toBeCloseTo(0.7, 9);
      // …and the published one has not.
      expect(Number(reopened.payload.physical.actualCumulative)).toBeCloseTo(0.4, 9);
    });

    it('menahan kendala yang sudah dihapus setelah terbit', async () => {
      const [p1] = await periodIds();
      const issue = await reports.saveIssue(user, projectId, null, {
        title: 'Alat berat mogok',
        description: null,
        severity: 'MEDIUM',
        status: 'OPEN',
        periodId: p1!,
      });

      const published = await reports.publishReport(user, projectId, p1!, 'WEEKLY');
      await reports.deleteIssue(user, projectId, issue.id);

      const reopened = await reports.getSnapshot(userId, projectId, published.id);
      expect(reopened.payload.issues.map((i) => i.title)).toContain('Alat berat mogok');
      expect(await reports.listIssues(userId, projectId)).toHaveLength(0);
    });

    it('mencatat jenis laporan dan waktu terbitnya', async () => {
      const [p1] = await periodIds();
      const published = await reports.publishReport(user, projectId, p1!, 'DAILY');

      const snapshots = await reports.listSnapshots(userId, projectId);
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]).toMatchObject({ id: published.id, reportType: 'DAILY' });
    });

    it('menyimpan setiap penerbitan, bukan menimpanya', async () => {
      const [p1] = await periodIds();
      await approveProgress(p1!, '0.2');
      const first = await reports.publishReport(user, projectId, p1!, 'WEEKLY');
      const second = await reports.publishReport(user, projectId, p1!, 'WEEKLY');

      expect(first.id).not.toBe(second.id);
      expect(await reports.listSnapshots(userId, projectId)).toHaveLength(2);
    });

    it('menolak laporan milik proyek lain', async () => {
      await expect(
        reports.getSnapshot(userId, projectId, randomUUID()),
      ).rejects.toThrow(/tidak ditemukan/);
    });
  });

  describe('kendala', () => {
    it('menolak judul kosong', async () => {
      await expect(
        reports.saveIssue(user, projectId, null, {
          title: '   ',
          description: null,
          severity: 'LOW',
          status: 'OPEN',
          periodId: null,
        }),
      ).rejects.toThrow(/wajib diisi/);
    });

    it('menyaring kendala per periode', async () => {
      const [p1, p2] = await periodIds();
      await reports.saveIssue(user, projectId, null, {
        title: 'Kendala Januari',
        description: null,
        severity: 'LOW',
        status: 'OPEN',
        periodId: p1!,
      });
      await reports.saveIssue(user, projectId, null, {
        title: 'Kendala Februari',
        description: null,
        severity: 'LOW',
        status: 'OPEN',
        periodId: p2!,
      });

      expect(await reports.listIssues(userId, projectId)).toHaveLength(2);
      const january = await reports.listIssues(userId, projectId, p1!);
      expect(january.map((i) => i.title)).toEqual(['Kendala Januari']);
    });
  });
});
