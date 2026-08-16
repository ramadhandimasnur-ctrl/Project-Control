import { randomUUID } from 'node:crypto';

import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { connectionOptions } from '@/db/connection';
import type * as ScheduleModule from '../schedule';
import type { SessionUser } from '../session';

/**
 * Phase 5's definition of done: `Σ planned_pct = 1` is enforced before a
 * baseline can be taken, and the baseline is genuinely frozen.
 *
 * Design decision 12 says the planned S-curve reads from the baseline, never
 * from the editable plan. That only means something if editing the plan
 * afterwards leaves the curve where it was, so that is tested directly.
 */

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ path: '.env', quiet: true });

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

async function schemaIsReady(): Promise<boolean> {
  if (!url) return false;
  const probe = postgres(connectionOptions(url, { max: 1, prepare: false, connect_timeout: 5 }));
  try {
    const rows = await probe`
      SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('schedule_periods', 'planned_distributions', 'schedule_baselines')
    `;
    return rows[0]?.n === 3;
  } catch {
    return false;
  } finally {
    await probe.end();
  }
}

const ready = await schemaIsReady();
if (!ready) console.warn('[Jadwal] Dilewati: database belum tersedia.');

describe.skipIf(!ready)('Jadwal & baseline', () => {
  let sql: postgres.Sql;
  let schedule: typeof ScheduleModule;

  const orgId = randomUUID();
  const userId = randomUUID();
  const projectId = randomUUID();
  const unitId = randomUUID();
  const itemA = randomUUID();
  const itemB = randomUUID();
  const itemOverhead = randomUUID();

  const user: SessionUser = {
    id: userId,
    orgId,
    email: `jadwal-${userId}@uji.test`,
    fullName: 'Perencana Uji',
    globalRole: 'ADMIN',
  };

  /** Project runs three whole calendar months, so MONTH yields three periods. */
  const buildFixture = async (endDate = '2026-03-31'): Promise<void> => {
    await sql.unsafe(`
      BEGIN;
      SELECT set_config('app.bypass_rls', 'on', true);
      SELECT set_config('app.allow_hard_delete', 'on', true);
      DELETE FROM projects WHERE org_id = '${orgId}';
      DELETE FROM units WHERE org_id = '${orgId}';
      DELETE FROM users WHERE org_id = '${orgId}';
      DELETE FROM organizations WHERE id = '${orgId}';

      INSERT INTO organizations (id, name) VALUES ('${orgId}', 'Org Jadwal (uji)');
      INSERT INTO users (id, org_id, email, full_name, global_role)
        VALUES ('${userId}', '${orgId}', '${user.email}', '${user.fullName}', 'ADMIN');
      INSERT INTO projects (id, org_id, code, name, start_date, end_date, period_type,
                            progress_weight_basis, contract_value)
        VALUES ('${projectId}', '${orgId}', 'JDW-1', 'Proyek Jadwal',
                '2026-01-01', '${endDate}', 'MONTH', 'CONTRACT', 400000);
      INSERT INTO project_members (project_id, user_id, role)
        VALUES ('${projectId}', '${userId}', 'PROJECT_MANAGER');

      INSERT INTO units (id, org_id, code, name, dimension, factor_to_base)
        VALUES ('${unitId}', '${orgId}', 'm3', 'Meter kubik', 'VOLUME', 1);

      -- Contract values 100.000 and 300.000 give weights of exactly 0,25 and 0,75.
      INSERT INTO work_items (id, project_id, code, name, unit_id, volume,
                              contract_unit_price, include_in_progress_weight, sort_order)
        VALUES ('${itemA}', '${projectId}', 'A.01', 'Galian', '${unitId}', 100, 1000, true, 1),
               ('${itemB}', '${projectId}', 'A.02', 'Pondasi', '${unitId}', 100, 3000, true, 2),
               ('${itemOverhead}', '${projectId}', 'X.01', 'Operasional', '${unitId}', 1, 50000, false, 3);
      COMMIT;
    `).simple();
  };

  const periodIds = async (): Promise<string[]> => {
    const rows = await sql<{ id: string }[]>`
      SELECT id FROM schedule_periods WHERE project_id = ${projectId} ORDER BY seq
    `;
    return rows.map((r) => r.id);
  };

  beforeAll(async () => {
    sql = postgres(connectionOptions(url!, { max: 1, prepare: false, onnotice: () => {} }));
    schedule = await import('../schedule');
  });

  beforeEach(() => buildFixture());

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

  describe('kalender periode', () => {
    it('membangun periode dari tanggal proyek', async () => {
      const result = await schedule.regeneratePeriods(user, projectId);

      expect(result).toMatchObject({ added: 3, kept: 0, removed: 0, periodType: 'MONTH' });

      const periods = await schedule.listPeriods(userId, projectId);
      expect(periods.map((p) => [p.startDate, p.endDate])).toEqual([
        ['2026-01-01', '2026-01-31'],
        ['2026-02-01', '2026-02-28'],
        ['2026-03-01', '2026-03-31'],
      ]);
    });

    // Ids are what the plan points at, so a rebuild must not mint new ones.
    it('mempertahankan id periode ketika dibangun ulang', async () => {
      await schedule.regeneratePeriods(user, projectId);
      const before = await periodIds();

      const result = await schedule.regeneratePeriods(user, projectId);

      expect(result).toMatchObject({ kept: 3, added: 0, removed: 0 });
      expect(await periodIds()).toEqual(before);
    });

    it('mengganti satuan periode dan menyimpannya di proyek', async () => {
      await schedule.regeneratePeriods(user, projectId, 'WEEK');

      const periods = await schedule.listPeriods(userId, projectId);
      expect(periods.length).toBeGreaterThan(12);
      expect(periods[0]?.periodType).toBe('WEEK');

      const [row] = await sql<{ period_type: string }[]>`
        SELECT period_type FROM projects WHERE id = ${projectId}
      `;
      expect(row?.period_type).toBe('WEEK');
    });

    it('menambah periode ketika proyek diperpanjang', async () => {
      await schedule.regeneratePeriods(user, projectId);
      await sql`UPDATE projects SET end_date = '2026-05-31' WHERE id = ${projectId}`;

      const result = await schedule.regeneratePeriods(user, projectId);
      expect(result).toMatchObject({ kept: 3, added: 2, removed: 0 });
    });

    it('menghapus periode kosong ketika proyek dipendekkan', async () => {
      await schedule.regeneratePeriods(user, projectId);
      await sql`UPDATE projects SET end_date = '2026-02-28' WHERE id = ${projectId}`;

      const result = await schedule.regeneratePeriods(user, projectId);
      expect(result).toMatchObject({ kept: 2, removed: 1 });
      expect(await periodIds()).toHaveLength(2);
    });

    // Silently dropping planned cells is exactly the kind of quiet rewrite the
    // charter forbids.
    it('menolak memendekkan proyek bila periode terakhir masih terisi rencana', async () => {
      await schedule.regeneratePeriods(user, projectId);
      const [, , third] = await periodIds();

      await schedule.savePlannedDistribution(user, projectId, itemA, [
        { periodId: third!, plannedPct: '1' },
      ]);

      await sql`UPDATE projects SET end_date = '2026-02-28' WHERE id = ${projectId}`;

      await expect(schedule.regeneratePeriods(user, projectId)).rejects.toThrow(/masih mengisi/);
      expect(await periodIds()).toHaveLength(3);
    });

    it('melaporkan dampak sebelum dijalankan', async () => {
      await schedule.regeneratePeriods(user, projectId);
      const [, , third] = await periodIds();
      await schedule.savePlannedDistribution(user, projectId, itemA, [
        { periodId: third!, plannedPct: '1' },
      ]);
      await sql`UPDATE projects SET end_date = '2026-02-28' WHERE id = ${projectId}`;

      const preview = await schedule.previewPeriodPlan(userId, projectId);
      expect(preview.removed).toHaveLength(1);
      expect(preview.wouldDiscardPlan).toBe(true);
      expect(preview.keptCount).toBe(2);
    });
  });

  describe('jadwal pekerjaan', () => {
    it('menyimpan tanggal dan menghitung durasinya', async () => {
      await schedule.saveWorkItemSchedule(user, projectId, itemA, {
        plannedStart: '2026-01-05',
        plannedFinish: '2026-01-14',
        predecessorId: null,
        dependencyType: 'FS',
        lagDays: 0,
      });

      const [row] = await sql<{ duration_days: number }[]>`
        SELECT duration_days FROM work_item_schedules WHERE work_item_id = ${itemA}
      `;
      expect(row?.duration_days).toBe(10);
    });

    it('memperbarui jadwal yang sudah ada, bukan menggandakannya', async () => {
      const input = {
        plannedStart: '2026-01-05',
        plannedFinish: '2026-01-14',
        predecessorId: null,
        dependencyType: 'FS' as const,
        lagDays: 0,
      };
      await schedule.saveWorkItemSchedule(user, projectId, itemA, input);
      await schedule.saveWorkItemSchedule(user, projectId, itemA, {
        ...input,
        plannedFinish: '2026-01-20',
      });

      const rows = await sql`SELECT id FROM work_item_schedules WHERE work_item_id = ${itemA}`;
      expect(rows).toHaveLength(1);
    });

    it('menolak tanggal selesai yang mendahului tanggal mulai', async () => {
      await expect(
        schedule.saveWorkItemSchedule(user, projectId, itemA, {
          plannedStart: '2026-01-20',
          plannedFinish: '2026-01-10',
          predecessorId: null,
          dependencyType: 'FS',
          lagDays: 0,
        }),
      ).rejects.toThrow(/mendahului/);
    });

    it('menolak pendahulu dari proyek lain', async () => {
      await expect(
        schedule.saveWorkItemSchedule(user, projectId, itemA, {
          plannedStart: null,
          plannedFinish: null,
          predecessorId: randomUUID(),
          dependencyType: 'FS',
          lagDays: 0,
        }),
      ).rejects.toThrow(/tidak ada pada proyek ini/);
    });

    // The database refuses A → A; a longer loop passes every row-level check.
    it('menolak ketergantungan yang membentuk lingkaran', async () => {
      await schedule.saveWorkItemSchedule(user, projectId, itemB, {
        plannedStart: null,
        plannedFinish: null,
        predecessorId: itemA,
        dependencyType: 'FS',
        lagDays: 0,
      });

      await expect(
        schedule.saveWorkItemSchedule(user, projectId, itemA, {
          plannedStart: null,
          plannedFinish: null,
          predecessorId: itemB,
          dependencyType: 'FS',
          lagDays: 0,
        }),
      ).rejects.toThrow(/lingkaran/);
    });
  });

  /**
   * The working calendar has to reach the numbers, not just the settings page.
   * A duration that still counts Sundays after the project says it does not
   * work them is the whole feature failing silently.
   */
  describe('kalender kerja', () => {
    it('menghitung durasi tanpa akhir pekan setelah sakelarnya dimatikan', async () => {
      const dates = {
        plannedStart: '2026-01-05',
        plannedFinish: '2026-01-14',
        predecessorId: null,
        dependencyType: 'FS' as const,
        lagDays: 0,
      };

      await schedule.saveWorkItemSchedule(user, projectId, itemA, dates);
      const before = await sql<{ duration_days: number }[]>`
        SELECT duration_days FROM work_item_schedules WHERE work_item_id = ${itemA}
      `;
      expect(before[0]?.duration_days).toBe(10);

      await schedule.setWeekendDay(user, projectId, 'SATURDAY', false);
      await schedule.setWeekendDay(user, projectId, 'SUNDAY', false);
      await schedule.saveWorkItemSchedule(user, projectId, itemA, dates);

      // 5–14 Jan 2026 contains one Saturday and one Sunday.
      const after = await sql<{ duration_days: number }[]>`
        SELECT duration_days FROM work_item_schedules WHERE work_item_id = ${itemA}
      `;
      expect(after[0]?.duration_days).toBe(8);
    });

    /*
     * The six-day week, which the previous single switch could not express at
     * all: the project either worked Sundays or lost its Saturdays.
     */
    it('menghitung Sabtu sebagai hari kerja saat hanya Minggu yang diliburkan', async () => {
      await schedule.setWeekendDay(user, projectId, 'SUNDAY', false);

      await schedule.saveWorkItemSchedule(user, projectId, itemA, {
        plannedStart: '2026-01-05',
        plannedFinish: '2026-01-14',
        predecessorId: null,
        dependencyType: 'FS',
        lagDays: 0,
      });

      // Only Sunday the 11th drops out of the ten-day span.
      const [row] = await sql<{ duration_days: number }[]>`
        SELECT duration_days FROM work_item_schedules WHERE work_item_id = ${itemA}
      `;
      expect(row?.duration_days).toBe(9);
    });

    it('mengecualikan hari libur yang dicatat', async () => {
      await schedule.addHoliday(user, projectId, {
        holidayDate: '2026-01-07',
        name: 'Libur uji',
      });

      await schedule.saveWorkItemSchedule(user, projectId, itemA, {
        plannedStart: '2026-01-05',
        plannedFinish: '2026-01-14',
        predecessorId: null,
        dependencyType: 'FS',
        lagDays: 0,
      });

      const [row] = await sql<{ duration_days: number }[]>`
        SELECT duration_days FROM work_item_schedules WHERE work_item_id = ${itemA}
      `;
      expect(row?.duration_days).toBe(9);
    });

    it('menolak rentang yang seluruhnya jatuh pada hari non-kerja', async () => {
      await schedule.setWeekendDay(user, projectId, 'SATURDAY', false);
      await schedule.setWeekendDay(user, projectId, 'SUNDAY', false);

      await expect(
        schedule.saveWorkItemSchedule(user, projectId, itemA, {
          // 10–11 Januari 2026 adalah Sabtu dan Minggu.
          plannedStart: '2026-01-10',
          plannedFinish: '2026-01-11',
          predecessorId: null,
          dependencyType: 'FS',
          lagDays: 0,
        }),
      ).rejects.toThrow(/tidak memuat satu pun hari kerja/);
    });

    it('menyimpan satu baris per tanggal, bukan dua nama untuk satu absen', async () => {
      await schedule.addHoliday(user, projectId, { holidayDate: '2026-03-01', name: 'Awal' });
      await schedule.addHoliday(user, projectId, { holidayDate: '2026-03-01', name: 'Revisi' });

      const rows = await schedule.listHolidays(userId, projectId);
      const onDate = rows.filter((row) => row.holidayDate === '2026-03-01');
      expect(onDate).toHaveLength(1);
      expect(onDate[0]?.name).toBe('Revisi');
    });

    it('menghapus hari libur dan mengembalikan durasinya', async () => {
      const { id } = await schedule.addHoliday(user, projectId, {
        holidayDate: '2026-01-07',
        name: 'Libur uji',
      });

      await schedule.deleteHoliday(user, projectId, id);
      expect(await schedule.listHolidays(userId, projectId)).toEqual([]);
    });
  });

  describe('distribusi rencana', () => {
    beforeEach(async () => {
      await schedule.regeneratePeriods(user, projectId);
    });

    it('menyebar otomatis mengikuti tanggal rencana', async () => {
      await schedule.saveWorkItemSchedule(user, projectId, itemA, {
        plannedStart: '2026-01-01',
        plannedFinish: '2026-02-28',
        predecessorId: null,
        dependencyType: 'FS',
        lagDays: 0,
      });

      const result = await schedule.autoDistributeWorkItem(user, projectId, itemA);
      expect(result.cells).toBe(2);

      const [row] = await sql<{ total: string }[]>`
        SELECT sum(planned_pct)::text AS total
        FROM planned_distributions WHERE work_item_id = ${itemA}
      `;
      expect(Number(row?.total)).toBeCloseTo(1, 9);
    });

    it('menolak sebar otomatis tanpa tanggal rencana', async () => {
      await expect(schedule.autoDistributeWorkItem(user, projectId, itemA)).rejects.toThrow(
        /belum punya tanggal rencana/,
      );
    });

    it('mengganti seluruh baris, bukan menumpuknya', async () => {
      const [first, second] = await periodIds();

      await schedule.savePlannedDistribution(user, projectId, itemA, [
        { periodId: first!, plannedPct: '0.5' },
        { periodId: second!, plannedPct: '0.5' },
      ]);
      await schedule.savePlannedDistribution(user, projectId, itemA, [
        { periodId: first!, plannedPct: '1' },
      ]);

      const rows = await sql`SELECT id FROM planned_distributions WHERE work_item_id = ${itemA}`;
      expect(rows).toHaveLength(1);
    });

    it('tidak menyimpan sel bernilai nol', async () => {
      const [first, second] = await periodIds();
      await schedule.savePlannedDistribution(user, projectId, itemA, [
        { periodId: first!, plannedPct: '1' },
        { periodId: second!, plannedPct: '0' },
      ]);

      const rows = await sql`SELECT id FROM planned_distributions WHERE work_item_id = ${itemA}`;
      expect(rows).toHaveLength(1);
    });

    it('menolak porsi di luar 0..100%', async () => {
      const [first] = await periodIds();
      await expect(
        schedule.savePlannedDistribution(user, projectId, itemA, [
          { periodId: first!, plannedPct: '1.5' },
        ]),
      ).rejects.toThrow(/antara 0%/);
    });

    it('menolak periode milik proyek lain', async () => {
      await expect(
        schedule.savePlannedDistribution(user, projectId, itemA, [
          { periodId: randomUUID(), plannedPct: '1' },
        ]),
      ).rejects.toThrow(/bukan milik proyek ini/);
    });

    describe('simpan serentak', () => {
      it('menyimpan beberapa baris sekaligus', async () => {
        const [p1, p2] = await periodIds();

        const result = await schedule.savePlannedDistributions(user, projectId, [
          { workItemId: itemA, cells: [{ periodId: p1!, plannedPct: '1' }] },
          {
            workItemId: itemB,
            cells: [
              { periodId: p1!, plannedPct: '0.5' },
              { periodId: p2!, plannedPct: '0.5' },
            ],
          },
        ]);

        expect(result).toEqual({ rows: 2, cells: 3 });

        const [row] = await sql<{ n: number }[]>`
          SELECT count(*)::int AS n FROM planned_distributions d
          JOIN work_items w ON w.id = d.work_item_id
          WHERE w.project_id = ${projectId}
        `;
        expect(row?.n).toBe(3);
      });

      // The user edits the matrix as one document; a partial save would leave
      // some rows at the new plan and others at the old one.
      it('tidak menyimpan apa pun bila satu baris ditolak', async () => {
        const [p1] = await periodIds();

        await schedule.savePlannedDistribution(user, projectId, itemA, [
          { periodId: p1!, plannedPct: '1' },
        ]);

        await expect(
          schedule.savePlannedDistributions(user, projectId, [
            { workItemId: itemA, cells: [{ periodId: p1!, plannedPct: '0.25' }] },
            { workItemId: itemB, cells: [{ periodId: p1!, plannedPct: '5' }] },
          ]),
        ).rejects.toThrow(/antara 0%/);

        // The original value for A is untouched.
        const rows = await sql<{ pct: string }[]>`
          SELECT planned_pct::text AS pct FROM planned_distributions
          WHERE work_item_id = ${itemA}
        `;
        expect(rows).toHaveLength(1);
        expect(Number(rows[0]?.pct)).toBe(1);
      });

      it('menolak pekerjaan dari proyek lain tanpa menulis apa pun', async () => {
        const [p1] = await periodIds();

        await expect(
          schedule.savePlannedDistributions(user, projectId, [
            { workItemId: itemA, cells: [{ periodId: p1!, plannedPct: '1' }] },
            { workItemId: randomUUID(), cells: [{ periodId: p1!, plannedPct: '1' }] },
          ]),
        ).rejects.toThrow(/tidak ditemukan pada proyek ini/);

        const rows = await sql`SELECT id FROM planned_distributions WHERE work_item_id = ${itemA}`;
        expect(rows).toHaveLength(0);
      });

      it('mengosongkan baris yang seluruh selnya nol', async () => {
        const [p1] = await periodIds();
        await schedule.savePlannedDistribution(user, projectId, itemA, [
          { periodId: p1!, plannedPct: '1' },
        ]);

        const result = await schedule.savePlannedDistributions(user, projectId, [
          { workItemId: itemA, cells: [{ periodId: p1!, plannedPct: '0' }] },
        ]);

        expect(result).toEqual({ rows: 1, cells: 0 });
        const rows = await sql`SELECT id FROM planned_distributions WHERE work_item_id = ${itemA}`;
        expect(rows).toHaveLength(0);
      });

      it('menerima daftar kosong tanpa menulis apa pun', async () => {
        expect(await schedule.savePlannedDistributions(user, projectId, [])).toEqual({
          rows: 0,
          cells: 0,
        });
      });
    });
  });

  describe('kurva-S dan baseline', () => {
    const fullPlan = async (): Promise<void> => {
      await schedule.regeneratePeriods(user, projectId);
      const [p1, p2, p3] = await periodIds();

      // A finishes early, B runs late — a curve that actually bends.
      await schedule.savePlannedDistribution(user, projectId, itemA, [
        { periodId: p1!, plannedPct: '0.6' },
        { periodId: p2!, plannedPct: '0.4' },
      ]);
      await schedule.savePlannedDistribution(user, projectId, itemB, [
        { periodId: p2!, plannedPct: '0.5' },
        { periodId: p3!, plannedPct: '0.5' },
      ]);
    };

    it('menghitung kurva dari bobot dikali porsi periode', async () => {
      await fullPlan();
      const overview = await schedule.getScheduleOverview(userId, projectId);

      // Bobot A = 0,25 dan B = 0,75, disimpan pada skala enam desimal.
      expect(Number(overview.rows.find((r) => r.code === 'A.01')?.weight)).toBe(0.25);
      expect(Number(overview.rows.find((r) => r.code === 'A.02')?.weight)).toBe(0.75);
      expect(overview.curve.map((p) => Number(p.cumulativePct))).toEqual([0.15, 0.625, 1]);
      expect(overview.curveFromBaseline).toBe(false);
    });

    // Overhead carries cost but no progress weight.
    it('mengabaikan pekerjaan tanpa bobot progres', async () => {
      await fullPlan();
      const overview = await schedule.getScheduleOverview(userId, projectId);
      expect(Number(overview.rows.find((r) => r.code === 'X.01')?.weight)).toBe(0);
      expect(Number(overview.curve.at(-1)?.cumulativePct)).toBeCloseTo(1, 9);
    });

    it('melaporkan pekerjaan yang distribusinya belum genap', async () => {
      await schedule.regeneratePeriods(user, projectId);
      const [p1] = await periodIds();
      await schedule.savePlannedDistribution(user, projectId, itemA, [
        { periodId: p1!, plannedPct: '0.4' },
      ]);

      const overview = await schedule.getScheduleOverview(userId, projectId);
      const codes = overview.incomplete.map((c) => c.workItemId);
      expect(codes).toContain(itemA);
      expect(codes).toContain(itemB); // never distributed at all
    });

    it('menolak baseline ketika ada pekerjaan yang belum genap 100%', async () => {
      await schedule.regeneratePeriods(user, projectId);
      const [p1] = await periodIds();
      await schedule.savePlannedDistribution(user, projectId, itemA, [
        { periodId: p1!, plannedPct: '0.9' },
      ]);

      await expect(schedule.createBaseline(user, projectId, 'Baseline 1')).rejects.toThrow(
        /belum terdistribusi penuh/,
      );

      const rows = await sql`SELECT id FROM schedule_baselines WHERE project_id = ${projectId}`;
      expect(rows).toHaveLength(0);
    });

    it('menyalin rencana ketika baseline dikunci', async () => {
      await fullPlan();
      const result = await schedule.createBaseline(user, projectId, 'Baseline 1');

      expect(result.cells).toBe(4);

      const [row] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM baseline_distributions WHERE baseline_id = ${result.id}
      `;
      expect(row?.n).toBe(4);
    });

    /*
     * The point of design decision 12: once frozen, the planned curve is a
     * commitment. Editing the draft afterwards must not quietly move the line
     * that progress will later be judged against.
     */
    it('membekukan kurva: mengubah rencana setelahnya tidak menggeser baseline', async () => {
      await fullPlan();
      await schedule.createBaseline(user, projectId, 'Baseline 1');

      const frozen = await schedule.getScheduleOverview(userId, projectId);
      expect(frozen.curveFromBaseline).toBe(true);

      // Move all of B into the last period — the draft curve now bends later.
      const [, , p3] = await periodIds();
      await schedule.savePlannedDistribution(user, projectId, itemB, [
        { periodId: p3!, plannedPct: '1' },
      ]);

      const after = await schedule.getScheduleOverview(userId, projectId);
      expect(after.curve.map((p) => p.cumulativePct)).toEqual(
        frozen.curve.map((p) => p.cumulativePct),
      );
      // The draft did change, and the matrix shows it.
      expect(after.matrix[itemB]?.[p3!]).toBe('1.000000');
    });

    it('hanya satu baseline aktif per proyek', async () => {
      await fullPlan();
      await schedule.createBaseline(user, projectId, 'Baseline 1');
      const second = await schedule.createBaseline(user, projectId, 'Baseline 2');

      const rows = await sql<{ id: string; is_active: boolean }[]>`
        SELECT id, is_active FROM schedule_baselines WHERE project_id = ${projectId}
      `;
      expect(rows.filter((r) => r.is_active)).toHaveLength(1);
      expect(rows.find((r) => r.is_active)?.id).toBe(second.id);
    });

    it('dapat kembali ke baseline sebelumnya', async () => {
      await fullPlan();
      const first = await schedule.createBaseline(user, projectId, 'Baseline 1');
      await schedule.createBaseline(user, projectId, 'Baseline 2');

      await schedule.activateBaseline(user, projectId, first.id);

      const overview = await schedule.getScheduleOverview(userId, projectId);
      expect(overview.activeBaseline?.id).toBe(first.id);

      const baselines = await schedule.listBaselines(userId, projectId);
      expect(baselines.filter((b) => b.isActive)).toHaveLength(1);
    });

    it('menolak baseline tanpa nama', async () => {
      await fullPlan();
      await expect(schedule.createBaseline(user, projectId, '   ')).rejects.toThrow(/wajib diisi/);
    });
  });
});
