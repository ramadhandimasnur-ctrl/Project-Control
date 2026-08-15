import { randomUUID } from 'node:crypto';

import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { connectionOptions } from '@/db/connection';
import type * as MilestoneModule from '../milestones';
import type * as ScheduleModule from '../schedule';
import type { SessionUser } from '../session';

/**
 * Milestone-driven progress.
 *
 * The rule that matters: a period is credited with the increment, so a stage
 * finished in January is not counted again in February.
 */

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ path: '.env', quiet: true });

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

async function schemaIsReady(): Promise<boolean> {
  if (!url) return false;
  const probe = postgres(connectionOptions(url, { max: 1, prepare: false, connect_timeout: 10 }));
  try {
    const rows = await probe`
      SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'work_item_milestones'
        AND column_name = 'completed_at'
    `;
    return rows[0]?.n === 1;
  } catch {
    return false;
  } finally {
    await probe.end();
  }
}

const ready = await schemaIsReady();
if (!ready) console.warn('[Tahapan] Dilewati: database belum tersedia.');

describe.skipIf(!ready)('Tahapan pekerjaan', () => {
  let sql: postgres.Sql;
  let milestones: typeof MilestoneModule;
  let schedule: typeof ScheduleModule;

  const orgId = randomUUID();
  const userId = randomUUID();
  const projectId = randomUUID();
  const unitId = randomUUID();
  const itemId = randomUUID();

  const user: SessionUser = {
    id: userId,
    orgId,
    email: `ms-${userId}@uji.test`,
    fullName: 'Perencana Tahapan',
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

      INSERT INTO organizations (id, name) VALUES ('${orgId}', 'Org Tahapan (uji)');
      INSERT INTO users (id, org_id, email, full_name, global_role)
        VALUES ('${userId}', '${orgId}', '${user.email}', '${user.fullName}', 'ADMIN');
      -- Checklist gate off: these tests are about milestone arithmetic, and its
      -- own behaviour is covered in the progress suite.
      INSERT INTO projects (id, org_id, code, name, start_date, end_date, period_type,
                            contract_value, require_checklist_before_approve)
        VALUES ('${projectId}', '${orgId}', 'MS-1', 'Proyek Tahapan',
                '2026-01-01', '2026-03-31', 'MONTH', 100000000, false);
      INSERT INTO project_members (project_id, user_id, role)
        VALUES ('${projectId}', '${userId}', 'PROJECT_MANAGER');
      INSERT INTO units (id, org_id, code, name, dimension, factor_to_base)
        VALUES ('${unitId}', '${orgId}', 'ls', 'Lumpsum', 'LUMPSUM', 1);
      INSERT INTO work_items (id, project_id, code, name, unit_id, volume,
                              contract_unit_price, include_in_progress_weight, progress_method)
        VALUES ('${itemId}', '${projectId}', 'A.01', 'Pondasi', '${unitId}', 1, 100000000, true, 'MILESTONE');
      COMMIT;
    `).simple();
  };

  const stage = (name: string, weight: string, completedAt: string | null = null) => ({
    id: null,
    name,
    weight,
    sortOrder: 0,
    completedAt,
  });

  beforeAll(async () => {
    sql = postgres(connectionOptions(url!, { max: 1, prepare: false, onnotice: () => {} }));
    [milestones, schedule] = await Promise.all([import('../milestones'), import('../schedule')]);
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

  describe('menyimpan tahapan', () => {
    it('menyimpan dan membaca kembali', async () => {
      await milestones.saveMilestones(user, projectId, itemId, [
        stage('Galian', '0.3'),
        stage('Pembesian', '0.4'),
        stage('Cor', '0.3'),
      ]);

      const set = await milestones.listMilestones(userId, projectId, itemId);
      expect(set.milestones).toHaveLength(3);
      expect(Number(set.totalWeight)).toBe(1);
      expect(Number(set.completion)).toBe(0);
    });

    it('menghitung penyelesaian dari tahapan yang ditandai selesai', async () => {
      await milestones.saveMilestones(user, projectId, itemId, [
        stage('Galian', '0.3', '2026-01-10'),
        stage('Pembesian', '0.4'),
        stage('Cor', '0.3'),
      ]);

      const set = await milestones.listMilestones(userId, projectId, itemId);
      expect(Number(set.completion)).toBeCloseTo(0.3, 9);
    });

    // A work item cannot be more than finished.
    it('menolak jumlah bobot melebihi 100%', async () => {
      await expect(
        milestones.saveMilestones(user, projectId, itemId, [
          stage('A', '0.6'),
          stage('B', '0.6'),
        ]),
      ).rejects.toThrow(/melebihi 100%/);
    });

    it('menolak bobot di luar 0..100%', async () => {
      await expect(
        milestones.saveMilestones(user, projectId, itemId, [stage('A', '1.5')]),
      ).rejects.toThrow(/antara 0%/);
    });

    // A half-specified checklist reports what it covers rather than being
    // scaled up into a claim nobody made.
    it('menandai daftar tahapan yang belum mencakup seluruh pekerjaan', async () => {
      await milestones.saveMilestones(user, projectId, itemId, [stage('Galian', '0.4')]);
      const set = await milestones.listMilestones(userId, projectId, itemId);

      expect(set.isUnderSpecified).toBe(true);
      expect(Number(set.totalWeight)).toBeCloseTo(0.4, 9);
    });

    it('mengganti seluruh daftar, bukan menumpuknya', async () => {
      await milestones.saveMilestones(user, projectId, itemId, [
        stage('A', '0.5'),
        stage('B', '0.5'),
      ]);
      await milestones.saveMilestones(user, projectId, itemId, [stage('C', '1')]);

      const set = await milestones.listMilestones(userId, projectId, itemId);
      expect(set.milestones.map((m) => m.name)).toEqual(['C']);
    });

    it('mengabaikan baris tanpa nama', async () => {
      await milestones.saveMilestones(user, projectId, itemId, [
        stage('Galian', '0.5'),
        stage('   ', '0.5'),
      ]);

      const set = await milestones.listMilestones(userId, projectId, itemId);
      expect(set.milestones).toHaveLength(1);
    });
  });

  describe('progres dari tahapan', () => {
    const periodIds = async (): Promise<string[]> => {
      const rows = await sql<{ id: string }[]>`
        SELECT id FROM schedule_periods WHERE project_id = ${projectId} ORDER BY seq
      `;
      return rows.map((r) => r.id);
    };

    beforeEach(async () => {
      await schedule.regeneratePeriods(user, projectId);
    });

    it('mencatat progres periode sebesar tahapan yang selesai', async () => {
      const [p1] = await periodIds();

      const result = await milestones.recordMilestoneProgress(user, projectId, itemId, p1!, {
        milestones: [
          stage('Galian', '0.3', '2026-01-10'),
          stage('Pembesian', '0.4'),
          stage('Cor', '0.3'),
        ],
        entryDate: '2026-01-31',
        note: null,
      });

      expect(Number(result.pctThisPeriod)).toBeCloseTo(0.3, 9);

      const [row] = await sql<{ pct: string; method: string }[]>`
        SELECT pct_this_period::text AS pct, method FROM progress_entries
        WHERE work_item_id = ${itemId}
      `;
      expect(Number(row?.pct)).toBeCloseTo(0.3, 9);
      expect(row?.method).toBe('MILESTONE');
    });

    /*
     * The rule this whole design exists for: a stage finished in January must
     * not be credited again in February.
     */
    it('hanya mencatat selisihnya pada periode berikutnya', async () => {
      const [p1, p2] = await periodIds();

      await milestones.recordMilestoneProgress(user, projectId, itemId, p1!, {
        milestones: [stage('Galian', '0.3', '2026-01-10'), stage('Pembesian', '0.4'), stage('Cor', '0.3')],
        entryDate: '2026-01-31',
        note: null,
      });

      // Approve January so it counts as already done.
      const progress = await import('../progress');
      const [entry] = await progress.listEntriesForPeriod(userId, projectId, p1!);
      await progress.submitProgressEntry(user, projectId, entry!.id);
      await progress.approveProgressEntry(user, projectId, entry!.id);

      const saved = await milestones.listMilestones(userId, projectId, itemId);
      const withSecond = saved.milestones.map((m) => ({
        id: m.id,
        name: m.name,
        weight: m.weight,
        sortOrder: m.sortOrder,
        completedAt: m.name === 'Pembesian' ? '2026-02-10' : m.completedAt,
      }));

      const result = await milestones.recordMilestoneProgress(user, projectId, itemId, p2!, {
        milestones: withSecond,
        entryDate: '2026-02-28',
        note: null,
      });

      // Kumulatif 70%, sudah disetujui 30%, jadi periode ini 40%.
      expect(Number(result.completion)).toBeCloseTo(0.7, 9);
      expect(Number(result.pctThisPeriod)).toBeCloseTo(0.4, 9);
    });

    // Un-ticking after approval cannot claw progress back out of a closed period.
    it('tidak pernah mencatat progres negatif', async () => {
      const [p1, p2] = await periodIds();

      await milestones.recordMilestoneProgress(user, projectId, itemId, p1!, {
        milestones: [stage('Galian', '0.5', '2026-01-10'), stage('Cor', '0.5')],
        entryDate: '2026-01-31',
        note: null,
      });

      const progress = await import('../progress');
      const [entry] = await progress.listEntriesForPeriod(userId, projectId, p1!);
      await progress.submitProgressEntry(user, projectId, entry!.id);
      await progress.approveProgressEntry(user, projectId, entry!.id);

      const saved = await milestones.listMilestones(userId, projectId, itemId);
      const untick = saved.milestones.map((m) => ({
        id: m.id,
        name: m.name,
        weight: m.weight,
        sortOrder: m.sortOrder,
        completedAt: null,
      }));

      const result = await milestones.recordMilestoneProgress(user, projectId, itemId, p2!, {
        milestones: untick,
        entryDate: '2026-02-28',
        note: null,
      });

      expect(Number(result.completion)).toBe(0);
      expect(Number(result.pctThisPeriod)).toBe(0);
    });
  });
});
