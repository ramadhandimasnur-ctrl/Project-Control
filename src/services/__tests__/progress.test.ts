import { randomUUID } from 'node:crypto';

import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { connectionOptions } from '@/db/connection';
import type * as ProgressModule from '../progress';
import type * as ScheduleModule from '../schedule';
import type { SessionUser } from '../session';

/**
 * Phase 6's definition of done: only approved progress moves the realised
 * curve, a work item can never exceed 100%, and the deviation against the
 * baseline is the number the project is judged by.
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
        AND table_name IN ('progress_entries', 'work_item_checklists', 'schedule_periods')
    `;
    return rows[0]?.n === 3;
  } catch {
    return false;
  } finally {
    await probe.end();
  }
}

const ready = await schemaIsReady();
if (!ready) console.warn('[Progres] Dilewati: database belum tersedia.');

describe.skipIf(!ready)('Progres lapangan', () => {
  let sql: postgres.Sql;
  let progress: typeof ProgressModule;
  let schedule: typeof ScheduleModule;

  const orgId = randomUUID();
  const managerId = randomUUID();
  const fieldId = randomUUID();
  const projectId = randomUUID();
  const unitId = randomUUID();
  const itemA = randomUUID();
  const itemB = randomUUID();

  const manager: SessionUser = {
    id: managerId,
    orgId,
    email: `pm-${managerId}@uji.test`,
    fullName: 'Manajer Uji',
    globalRole: 'ADMIN',
  };

  const field: SessionUser = {
    id: fieldId,
    orgId,
    email: `field-${fieldId}@uji.test`,
    fullName: 'Pelaksana Uji',
    globalRole: 'MEMBER',
  };

  const buildFixture = async (requireChecklist = false): Promise<void> => {
    await sql.unsafe(`
      BEGIN;
      SELECT set_config('app.bypass_rls', 'on', true);
      SELECT set_config('app.allow_hard_delete', 'on', true);
      DELETE FROM projects WHERE org_id = '${orgId}';
      DELETE FROM units WHERE org_id = '${orgId}';
      DELETE FROM users WHERE org_id = '${orgId}';
      DELETE FROM organizations WHERE id = '${orgId}';

      INSERT INTO organizations (id, name) VALUES ('${orgId}', 'Org Progres (uji)');
      INSERT INTO users (id, org_id, email, full_name, global_role) VALUES
        ('${managerId}', '${orgId}', '${manager.email}', '${manager.fullName}', 'ADMIN'),
        ('${fieldId}', '${orgId}', '${field.email}', '${field.fullName}', 'MEMBER');

      INSERT INTO projects (id, org_id, code, name, start_date, end_date, period_type,
                            progress_weight_basis, contract_value,
                            require_checklist_before_approve,
                            threshold_warning, threshold_delayed)
        VALUES ('${projectId}', '${orgId}', 'PRG-1', 'Proyek Progres',
                '2026-01-01', '2026-03-31', 'MONTH', 'CONTRACT', 400000,
                ${requireChecklist}, -0.005, -0.05);

      INSERT INTO project_members (project_id, user_id, role) VALUES
        ('${projectId}', '${managerId}', 'PROJECT_MANAGER'),
        ('${projectId}', '${fieldId}', 'FIELD_USER');

      INSERT INTO units (id, org_id, code, name, dimension, factor_to_base)
        VALUES ('${unitId}', '${orgId}', 'm3', 'Meter kubik', 'VOLUME', 1);

      -- Contract values 100.000 and 300.000 give weights of exactly 0,25 and 0,75.
      INSERT INTO work_items (id, project_id, code, name, unit_id, volume,
                              contract_unit_price, include_in_progress_weight,
                              progress_method, sort_order)
        VALUES ('${itemA}', '${projectId}', 'A.01', 'Galian', '${unitId}', 100, 1000, true, 'VOLUME', 1),
               ('${itemB}', '${projectId}', 'A.02', 'Pondasi', '${unitId}', 100, 3000, true, 'PERCENT', 2);
      COMMIT;
    `).simple();
  };

  const periodIds = async (): Promise<string[]> => {
    const rows = await sql<{ id: string }[]>`
      SELECT id FROM schedule_periods WHERE project_id = ${projectId} ORDER BY seq
    `;
    return rows.map((r) => r.id);
  };

  /** Periods, a full plan, and a locked baseline to deviate from. */
  const buildPlan = async (): Promise<string[]> => {
    await schedule.regeneratePeriods(manager, projectId);
    const [p1, p2, p3] = await periodIds();

    await schedule.savePlannedDistributions(manager, projectId, [
      {
        workItemId: itemA,
        cells: [
          { periodId: p1!, plannedPct: '0.5' },
          { periodId: p2!, plannedPct: '0.5' },
        ],
      },
      {
        workItemId: itemB,
        cells: [
          { periodId: p2!, plannedPct: '0.5' },
          { periodId: p3!, plannedPct: '0.5' },
        ],
      },
    ]);

    await schedule.createBaseline(manager, projectId, 'Baseline uji');
    return [p1!, p2!, p3!];
  };

  const report = async (
    workItemId: string,
    periodId: string,
    input: Partial<ProgressModule.ProgressEntryInput> = {},
  ) =>
    progress.saveProgressEntry(field, projectId, workItemId, periodId, {
      method: 'PERCENT',
      qtyThisPeriod: null,
      pctThisPeriod: '1',
      entryDate: '2026-01-31',
      note: null,
      ...input,
    });

  const passChecklist = (workItemId: string, periodId: string) =>
    progress.saveChecklist(field, projectId, workItemId, periodId, {
      asDrawing: 'PASS',
      position: 'PASS',
      dimension: 'PASS',
      checkedAt: '2026-01-31',
      note: null,
    });

  beforeAll(async () => {
    sql = postgres(connectionOptions(url!, { max: 1, prepare: false, onnotice: () => {} }));
    [progress, schedule] = await Promise.all([import('../progress'), import('../schedule')]);
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

  describe('pencatatan', () => {
    it('menurunkan persentase dari kuantitas', async () => {
      const [p1] = await buildPlan();
      await report(itemA, p1!, { method: 'VOLUME', qtyThisPeriod: '25', pctThisPeriod: null });

      const [row] = await sql<{ qty: string; pct: string }[]>`
        SELECT qty_this_period::text AS qty, pct_this_period::text AS pct
        FROM progress_entries WHERE work_item_id = ${itemA}
      `;
      expect(Number(row?.qty)).toBe(25);
      expect(Number(row?.pct)).toBe(0.25);
    });

    it('menurunkan kuantitas dari persentase', async () => {
      const [p1] = await buildPlan();
      await report(itemB, p1!, { pctThisPeriod: '0.4' });

      const [row] = await sql<{ qty: string }[]>`
        SELECT qty_this_period::text AS qty FROM progress_entries WHERE work_item_id = ${itemB}
      `;
      expect(Number(row?.qty)).toBe(40);
    });

    it('memperbarui catatan periode yang sama, bukan menggandakannya', async () => {
      const [p1] = await buildPlan();
      await report(itemA, p1!, { pctThisPeriod: '0.3' });
      await report(itemA, p1!, { pctThisPeriod: '0.6' });

      const rows = await sql`SELECT id FROM progress_entries WHERE work_item_id = ${itemA}`;
      expect(rows).toHaveLength(1);
    });

    it('mulai sebagai draf', async () => {
      const [p1] = await buildPlan();
      await report(itemA, p1!);

      const [row] = await sql<{ status: string }[]>`
        SELECT status FROM progress_entries WHERE work_item_id = ${itemA}
      `;
      expect(row?.status).toBe('DRAFT');
    });

    it('menolak periode milik proyek lain', async () => {
      await buildPlan();
      await expect(report(itemA, randomUUID())).rejects.toThrow(/tidak dikenal/);
    });
  });

  describe('batas 100%', () => {
    it('menolak pencatatan yang melewati sisa pekerjaan', async () => {
      const [p1, p2] = await buildPlan();

      await report(itemA, p1!, { pctThisPeriod: '0.8' });
      const entries = await progress.listEntriesForPeriod(managerId, projectId, p1!);
      await progress.submitProgressEntry(field, projectId, entries[0]!.id);
      await progress.approveProgressEntry(manager, projectId, entries[0]!.id);

      await expect(report(itemA, p2!, { pctThisPeriod: '0.5' })).rejects.toThrow(/tinggal 20/);
    });

    it('mengizinkan tepat sampai 100%', async () => {
      const [p1, p2] = await buildPlan();

      await report(itemA, p1!, { pctThisPeriod: '0.8' });
      const first = await progress.listEntriesForPeriod(managerId, projectId, p1!);
      await progress.submitProgressEntry(field, projectId, first[0]!.id);
      await progress.approveProgressEntry(manager, projectId, first[0]!.id);

      await expect(report(itemA, p2!, { pctThisPeriod: '0.2' })).resolves.toBeTruthy();
    });

    // Two drafts can each look reasonable and overshoot together.
    it('menangkap kelebihan pada saat persetujuan, bukan hanya saat menyimpan', async () => {
      const [p1, p2] = await buildPlan();

      await report(itemA, p1!, { pctThisPeriod: '0.7' });
      await report(itemA, p2!, { pctThisPeriod: '0.7' });

      const e1 = (await progress.listEntriesForPeriod(managerId, projectId, p1!))[0]!;
      const e2 = (await progress.listEntriesForPeriod(managerId, projectId, p2!))[0]!;

      await progress.submitProgressEntry(field, projectId, e1.id);
      await progress.submitProgressEntry(field, projectId, e2.id);
      await progress.approveProgressEntry(manager, projectId, e1.id);

      await expect(progress.approveProgressEntry(manager, projectId, e2.id)).rejects.toThrow(
        /melewati 100%/,
      );
    });

    it('tidak menghitung catatannya sendiri saat disunting', async () => {
      const [p1] = await buildPlan();
      await report(itemA, p1!, { pctThisPeriod: '1' });
      await expect(report(itemA, p1!, { pctThisPeriod: '0.9' })).resolves.toBeTruthy();
    });
  });

  /**
   * Withdrawal, as distinct from rejection.
   *
   * The rules that matter: a cancelled row stops counting, stays visible, and
   * becomes editable again — and approved work can never be unwound this way.
   */
  describe('pembatalan', () => {
    const entryFor = async (workItemId: string, periodId: string) => {
      const entries = await progress.listEntriesForPeriod(managerId, projectId, periodId);
      return entries.find((entry) => entry.workItemId === workItemId)!;
    };

    it('membatalkan draf dan menyisakan catatannya', async () => {
      const [p1] = await buildPlan();
      await report(itemA, p1!, { pctThisPeriod: '0.5' });
      const entry = await entryFor(itemA, p1!);

      await progress.cancelProgressEntry(field, projectId, entry.id, 'salah pekerjaan');

      const [row] = await sql<{ status: string; reject_reason: string | null }[]>`
        SELECT status, reject_reason FROM progress_entries WHERE id = ${entry.id}
      `;
      expect(row?.status).toBe('CANCELLED');
      expect(row?.reject_reason).toBe('salah pekerjaan');
    });

    it('menarik pengajuan yang sedang menunggu keputusan', async () => {
      const [p1] = await buildPlan();
      await report(itemA, p1!, { pctThisPeriod: '0.5' });
      const entry = await entryFor(itemA, p1!);
      await progress.submitProgressEntry(field, projectId, entry.id);

      await progress.cancelProgressEntry(field, projectId, entry.id);

      const board = await progress.getProgressBoard(managerId, projectId, p1!);
      expect(board.rows.find((row) => row.code === 'A.01')?.status).toBe('CANCELLED');
      expect(board.pendingCount).toBe(0);
    });

    /*
     * The whole point of cancelling rather than deleting: the figure can be
     * corrected in place instead of re-entered from nothing.
     */
    it('membuka catatan yang dibatalkan untuk diperbaiki', async () => {
      const [p1] = await buildPlan();
      await report(itemA, p1!, { pctThisPeriod: '0.5' });
      const entry = await entryFor(itemA, p1!);
      await progress.cancelProgressEntry(field, projectId, entry.id);

      await report(itemA, p1!, { pctThisPeriod: '0.3' });

      const board = await progress.getProgressBoard(managerId, projectId, p1!);
      const row = board.rows.find((r) => r.code === 'A.01');
      expect(row?.status).toBe('DRAFT');
      expect(Number(row?.pctThisPeriod)).toBeCloseTo(0.3, 9);
    });

    it('menolak penyuntingan catatan yang sedang diajukan', async () => {
      const [p1] = await buildPlan();
      await report(itemA, p1!, { pctThisPeriod: '0.5' });
      const entry = await entryFor(itemA, p1!);
      await progress.submitProgressEntry(field, projectId, entry.id);

      await expect(report(itemA, p1!, { pctThisPeriod: '0.3' })).rejects.toThrow(
        /sedang diajukan/i,
      );
    });

    it('menolak pembatalan progres yang sudah disetujui', async () => {
      const [p1] = await buildPlan();
      await report(itemA, p1!, { pctThisPeriod: '0.5' });
      const entry = await entryFor(itemA, p1!);
      await progress.submitProgressEntry(field, projectId, entry.id);
      await progress.approveProgressEntry(manager, projectId, entry.id);

      await expect(
        progress.cancelProgressEntry(field, projectId, entry.id),
      ).rejects.toThrow(/sudah disetujui tidak dapat dibatalkan/i);
    });

    /*
     * A withdrawn claim must not move the curve, and must give its quota back:
     * cancelling 60% has to leave the full 100% available again.
     */
    it('tidak menghitung apa pun pada kurva dan mengembalikan sisanya', async () => {
      const [p1, p2] = await buildPlan();
      await report(itemA, p1!, { pctThisPeriod: '0.6' });
      const entry = await entryFor(itemA, p1!);
      await progress.submitProgressEntry(field, projectId, entry.id);
      await progress.approveProgressEntry(manager, projectId, entry.id);

      const before = await progress.getProgressComparison(managerId, projectId);
      expect(Number(before.current.actualCumulative)).toBeCloseTo(0.15, 9);

      // Cancelling an approved row is refused, so the realistic path is a
      // second period's draft being withdrawn.
      await report(itemA, p2!, { pctThisPeriod: '0.4' });
      const second = await entryFor(itemA, p2!);
      await progress.cancelProgressEntry(field, projectId, second.id);

      const after = await progress.getProgressComparison(managerId, projectId);
      expect(Number(after.current.actualCumulative)).toBeCloseTo(0.15, 9);

      const board = await progress.getProgressBoard(managerId, projectId, p2!);
      expect(Number(board.rows.find((r) => r.code === 'A.01')?.remaining)).toBeCloseTo(0.4, 9);
    });

    it('menolak pembatalan ganda', async () => {
      const [p1] = await buildPlan();
      await report(itemA, p1!, { pctThisPeriod: '0.5' });
      const entry = await entryFor(itemA, p1!);
      await progress.cancelProgressEntry(field, projectId, entry.id);

      await expect(
        progress.cancelProgressEntry(field, projectId, entry.id),
      ).rejects.toThrow(/sudah dibatalkan/i);
    });
  });

  describe('alur persetujuan', () => {
    it('draf → diajukan → disetujui', async () => {
      const [p1] = await buildPlan();
      await report(itemA, p1!);
      const entry = (await progress.listEntriesForPeriod(managerId, projectId, p1!))[0]!;

      await progress.submitProgressEntry(field, projectId, entry.id);
      await progress.approveProgressEntry(manager, projectId, entry.id);

      const [row] = await sql<{ status: string; approved_by: string }[]>`
        SELECT status, approved_by FROM progress_entries WHERE id = ${entry.id}
      `;
      expect(row?.status).toBe('APPROVED');
      expect(row?.approved_by).toBe(managerId);
    });

    it('menolak persetujuan atas draf yang belum diajukan', async () => {
      const [p1] = await buildPlan();
      await report(itemA, p1!);
      const entry = (await progress.listEntriesForPeriod(managerId, projectId, p1!))[0]!;

      await expect(progress.approveProgressEntry(manager, projectId, entry.id)).rejects.toThrow(
        /masih draf/,
      );
    });

    // A supervisor must not sign off their own work.
    it('menolak persetujuan oleh peran lapangan', async () => {
      const [p1] = await buildPlan();
      await report(itemA, p1!);
      const entry = (await progress.listEntriesForPeriod(managerId, projectId, p1!))[0]!;
      await progress.submitProgressEntry(field, projectId, entry.id);

      await expect(progress.approveProgressEntry(field, projectId, entry.id)).rejects.toThrow(
        /tidak berwenang/,
      );
    });

    it('menolak dengan alasan, dan alasannya wajib', async () => {
      const [p1] = await buildPlan();
      await report(itemA, p1!);
      const entry = (await progress.listEntriesForPeriod(managerId, projectId, p1!))[0]!;
      await progress.submitProgressEntry(field, projectId, entry.id);

      await expect(progress.rejectProgressEntry(manager, projectId, entry.id, '  ')).rejects.toThrow(
        /wajib diisi/,
      );

      await progress.rejectProgressEntry(manager, projectId, entry.id, 'Foto tidak jelas');
      const [row] = await sql<{ status: string; reject_reason: string }[]>`
        SELECT status, reject_reason FROM progress_entries WHERE id = ${entry.id}
      `;
      expect(row?.status).toBe('REJECTED');
      expect(row?.reject_reason).toBe('Foto tidak jelas');
    });

    // Editing a rejected entry should not carry the old reason beside new numbers.
    it('membersihkan alasan penolakan ketika catatannya disunting', async () => {
      const [p1] = await buildPlan();
      await report(itemA, p1!);
      const entry = (await progress.listEntriesForPeriod(managerId, projectId, p1!))[0]!;
      await progress.submitProgressEntry(field, projectId, entry.id);
      await progress.rejectProgressEntry(manager, projectId, entry.id, 'Kurang bukti');

      await report(itemA, p1!, { pctThisPeriod: '0.5' });

      const [row] = await sql<{ status: string; reject_reason: string | null }[]>`
        SELECT status, reject_reason FROM progress_entries WHERE id = ${entry.id}
      `;
      expect(row?.status).toBe('DRAFT');
      expect(row?.reject_reason).toBeNull();
    });

    it('menolak perubahan progres yang sudah disetujui', async () => {
      const [p1] = await buildPlan();
      await report(itemA, p1!);
      const entry = (await progress.listEntriesForPeriod(managerId, projectId, p1!))[0]!;
      await progress.submitProgressEntry(field, projectId, entry.id);
      await progress.approveProgressEntry(manager, projectId, entry.id);

      await expect(report(itemA, p1!, { pctThisPeriod: '0.2' })).rejects.toThrow(/sudah disetujui/);
    });

    it('menolak penghapusan progres yang sudah disetujui', async () => {
      const [p1] = await buildPlan();
      await report(itemA, p1!);
      const entry = (await progress.listEntriesForPeriod(managerId, projectId, p1!))[0]!;
      await progress.submitProgressEntry(field, projectId, entry.id);
      await progress.approveProgressEntry(manager, projectId, entry.id);

      await expect(progress.deleteProgressEntry(manager, projectId, entry.id)).rejects.toThrow(
        /tidak dapat dihapus/,
      );
    });
  });

  describe('gerbang checklist mutu', () => {
    beforeEach(() => buildFixture(true));

    it('menolak persetujuan ketika checklist belum diisi', async () => {
      const [p1] = await buildPlan();
      await report(itemA, p1!);
      const entry = (await progress.listEntriesForPeriod(managerId, projectId, p1!))[0]!;
      await progress.submitProgressEntry(field, projectId, entry.id);

      await expect(progress.approveProgressEntry(manager, projectId, entry.id)).rejects.toThrow(
        /belum diisi/,
      );
    });

    it('menolak persetujuan ketika ada butir yang gagal', async () => {
      const [p1] = await buildPlan();
      await report(itemA, p1!);
      const entry = (await progress.listEntriesForPeriod(managerId, projectId, p1!))[0]!;
      await progress.submitProgressEntry(field, projectId, entry.id);

      await progress.saveChecklist(field, projectId, itemA, p1!, {
        asDrawing: 'PASS',
        position: 'PASS',
        dimension: 'FAIL',
        checkedAt: '2026-01-31',
        note: null,
      });

      await expect(progress.approveProgressEntry(manager, projectId, entry.id)).rejects.toThrow(
        /belum lulus/,
      );
    });

    it('meloloskan persetujuan setelah checklist lulus', async () => {
      const [p1] = await buildPlan();
      await report(itemA, p1!);
      const entry = (await progress.listEntriesForPeriod(managerId, projectId, p1!))[0]!;
      await progress.submitProgressEntry(field, projectId, entry.id);
      await passChecklist(itemA, p1!);

      await expect(
        progress.approveProgressEntry(manager, projectId, entry.id),
      ).resolves.toBeUndefined();
    });

    // The verdict is a generated column; no caller can write a PASS over a FAIL.
    it('menghitung sendiri putusan checklist-nya', async () => {
      const [p1] = await buildPlan();
      await progress.saveChecklist(field, projectId, itemA, p1!, {
        asDrawing: 'PASS',
        position: 'NA',
        dimension: 'PASS',
        checkedAt: null,
        note: null,
      });

      const [row] = await sql<{ verdict: string }[]>`
        SELECT verdict FROM work_item_checklists WHERE work_item_id = ${itemA}
      `;
      expect(row?.verdict).toBe('NA');
    });
  });

  describe('kurva realisasi dan deviasi', () => {
    it('tidak menggerakkan kurva sebelum disetujui', async () => {
      const [p1] = await buildPlan();
      await report(itemA, p1!);
      const entry = (await progress.listEntriesForPeriod(managerId, projectId, p1!))[0]!;
      await progress.submitProgressEntry(field, projectId, entry.id);

      const before = await progress.getProgressComparison(managerId, projectId);
      expect(before.hasActual).toBe(false);
      expect(Number(before.points[0]?.actualCumulative)).toBe(0);

      await progress.approveProgressEntry(manager, projectId, entry.id);

      const after = await progress.getProgressComparison(managerId, projectId);
      expect(after.hasActual).toBe(true);
      // Item A carries a weight of 0,25 and is fully done.
      expect(Number(after.points[0]?.actualCumulative)).toBeCloseTo(0.25, 9);
    });

    it('membandingkan terhadap baseline, bukan draf rencana', async () => {
      const [p1] = await buildPlan();
      const comparison = await progress.getProgressComparison(managerId, projectId);
      expect(comparison.curveFromBaseline).toBe(true);
      // Plan for period 1: item A does half of itself, weight 0,25 → 0,125.
      expect(Number(comparison.points[0]?.plannedCumulative)).toBeCloseTo(0.125, 9);
      expect(p1).toBeTruthy();
    });

    it('menyebut proyek lebih cepat ketika realisasi melampaui rencana', async () => {
      const [p1] = await buildPlan();
      await report(itemA, p1!);
      const entry = (await progress.listEntriesForPeriod(managerId, projectId, p1!))[0]!;
      await progress.submitProgressEntry(field, projectId, entry.id);
      await progress.approveProgressEntry(manager, projectId, entry.id);

      const comparison = await progress.getProgressComparison(managerId, projectId);
      // Rencana 0,125 lawan realisasi 0,25.
      expect(comparison.current.status).toBe('AHEAD');
      expect(Number(comparison.current.deviation)).toBeCloseTo(0.125, 9);
      expect(Number(comparison.current.spi)).toBeCloseTo(2, 9);
    });

    it('menyebut proyek terlambat ketika realisasi tertinggal jauh', async () => {
      const [p1] = await buildPlan();
      await report(itemA, p1!, { pctThisPeriod: '0.1' });
      const entry = (await progress.listEntriesForPeriod(managerId, projectId, p1!))[0]!;
      await progress.submitProgressEntry(field, projectId, entry.id);
      await progress.approveProgressEntry(manager, projectId, entry.id);

      const comparison = await progress.getProgressComparison(managerId, projectId);
      // Rencana 0,125 lawan realisasi 0,025 → tertinggal 10%.
      expect(comparison.current.status).toBe('DELAYED');
    });

    it('tidak menghakimi proyek yang belum melaporkan apa pun', async () => {
      await buildPlan();
      const comparison = await progress.getProgressComparison(managerId, projectId);
      expect(comparison.hasActual).toBe(false);
      expect(comparison.current.periodLabel).toBeNull();
      expect(comparison.points.every((point) => point.spi === null)).toBe(true);
    });
  });

  describe('papan progres', () => {
    it('menampilkan sisa yang boleh dilaporkan', async () => {
      const [p1, p2] = await buildPlan();
      await report(itemA, p1!, { pctThisPeriod: '0.6' });
      const entry = (await progress.listEntriesForPeriod(managerId, projectId, p1!))[0]!;
      await progress.submitProgressEntry(field, projectId, entry.id);
      await progress.approveProgressEntry(manager, projectId, entry.id);

      const board = await progress.getProgressBoard(managerId, projectId, p2!);
      const row = board.rows.find((r) => r.code === 'A.01');
      expect(Number(row?.completedBefore)).toBeCloseTo(0.6, 9);
      expect(Number(row?.remaining)).toBeCloseTo(0.4, 9);
    });

    /**
     * The columns a weekly report is read down. Item A carries a weight of
     * 0,25 and item B 0,75; the plan gives A half of itself in each of the
     * first two periods.
     */
    describe('kolom bobot', () => {
      const approve = async (workItemId: string, periodId: string) => {
        const entries = await progress.listEntriesForPeriod(managerId, projectId, periodId);
        const entry = entries.find((e) => e.workItemId === workItemId)!;
        await progress.submitProgressEntry(field, projectId, entry.id);
        await progress.approveProgressEntry(manager, projectId, entry.id);
      };

      it('memisahkan periode lalu, periode ini, dan kumulatifnya', async () => {
        const [p1, p2] = await buildPlan();
        await report(itemA, p1!, { pctThisPeriod: '0.5' });
        await approve(itemA, p1!);
        await report(itemA, p2!, { pctThisPeriod: '0.3' });
        await approve(itemA, p2!);

        const board = await progress.getProgressBoard(managerId, projectId, p2!);
        const row = board.rows.find((r) => r.code === 'A.01');

        expect(Number(row?.weighted.previous)).toBeCloseTo(0.125, 9);
        expect(Number(row?.weighted.current)).toBeCloseTo(0.075, 9);
        expect(Number(row?.weighted.cumulative)).toBeCloseTo(0.2, 9);
        // Rencana menuntut item A selesai penuh pada periode 2.
        expect(Number(row?.weighted.planned)).toBeCloseTo(0.25, 9);
        expect(Number(row?.weighted.deviation)).toBeCloseTo(-0.05, 9);
      });

      /*
       * The point of weighting: the column adds up to the realised curve. If
       * these two ever disagree the report contradicts its own headline.
       */
      it('menjumlah persis sebesar kurva realisasi', async () => {
        const [p1, p2] = await buildPlan();
        await report(itemA, p1!, { pctThisPeriod: '0.5' });
        await approve(itemA, p1!);
        await report(itemB, p2!, { pctThisPeriod: '0.4' });
        await approve(itemB, p2!);

        const board = await progress.getProgressBoard(managerId, projectId, p2!);
        const total = board.rows.reduce((acc, row) => acc + Number(row.weighted.cumulative), 0);

        const comparison = await progress.getProgressComparison(managerId, projectId);
        const atPeriod = comparison.points.find((point) => point.periodId === p2);

        expect(total).toBeCloseTo(Number(atPeriod?.actualCumulative), 9);
        expect(total).toBeCloseTo(0.425, 9);
      });

      it('tidak menghitung catatan yang belum disetujui', async () => {
        const [p1] = await buildPlan();
        await report(itemA, p1!, { pctThisPeriod: '0.5' });

        const board = await progress.getProgressBoard(managerId, projectId, p1!);
        const row = board.rows.find((r) => r.code === 'A.01');

        expect(row?.status).toBe('DRAFT');
        expect(Number(row?.weighted.current)).toBe(0);
        expect(Number(row?.pctThisPeriod)).toBeCloseTo(0.5, 9);
      });

      /*
       * A correction approved for a later period must not appear in a column
       * headed "last period" — that is the difference between `earnedBefore`
       * and `completedBefore`, and it only shows up out of order.
       */
      it('tidak menarik periode berikutnya ke dalam kolom periode lalu', async () => {
        const [p1, p2] = await buildPlan();
        await report(itemA, p2!, { pctThisPeriod: '0.4' });
        await approve(itemA, p2!);

        const board = await progress.getProgressBoard(managerId, projectId, p1!);
        const row = board.rows.find((r) => r.code === 'A.01');

        expect(Number(row?.completedBefore)).toBeCloseTo(0.4, 9);
        expect(Number(row?.earnedBefore)).toBe(0);
        expect(Number(row?.weighted.previous)).toBe(0);
      });

      it('membaca rencana dari baseline aktif', async () => {
        const [p1] = await buildPlan();
        const board = await progress.getProgressBoard(managerId, projectId, p1!);
        const row = board.rows.find((r) => r.code === 'A.01');

        expect(board.planFromBaseline).toBe(true);
        expect(board.periodType).toBe('MONTH');
        // Setengah item A pada periode 1, berbobot 0,25 → 0,125.
        expect(Number(row?.plannedCumulative)).toBeCloseTo(0.5, 9);
        expect(Number(row?.weighted.planned)).toBeCloseTo(0.125, 9);
      });
    });

    it('menghitung catatan yang menunggu keputusan', async () => {
      const [p1] = await buildPlan();
      await report(itemA, p1!);
      await report(itemB, p1!);
      for (const entry of await progress.listEntriesForPeriod(managerId, projectId, p1!)) {
        await progress.submitProgressEntry(field, projectId, entry.id);
      }

      const board = await progress.getProgressBoard(managerId, projectId, p1!);
      expect(board.pendingCount).toBe(2);
      expect(board.canApprove).toBe(true);
    });

    it('menyetujui sekaligus dan melaporkan yang gagal', async () => {
      const [p1] = await buildPlan();
      await report(itemA, p1!, { pctThisPeriod: '1' });
      await report(itemB, p1!, { pctThisPeriod: '1' });
      const ids = await progress.pendingEntryIds(managerId, projectId, p1!);
      expect(ids).toHaveLength(0); // still drafts

      for (const entry of await progress.listEntriesForPeriod(managerId, projectId, p1!)) {
        await progress.submitProgressEntry(field, projectId, entry.id);
      }

      const pending = await progress.pendingEntryIds(managerId, projectId, p1!);
      const result = await progress.approveManyProgressEntries(manager, projectId, pending);
      expect(result.approved).toBe(2);
      expect(result.skipped).toHaveLength(0);
    });
  });
});
