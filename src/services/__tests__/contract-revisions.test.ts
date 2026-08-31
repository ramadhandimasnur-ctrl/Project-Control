import { randomUUID } from 'node:crypto';

import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { connectionOptions } from '@/db/connection';
import type * as RevisionsModule from '../contract-revisions';
import type { SessionUser } from '../session';
import { guardDatabase, probeSchema } from './_support/schema-probe';

/**
 * Change orders end to end: draft, approve, and what approval does to the
 * project it is applied to.
 *
 * Approval is the only place in the system that rewrites volumes on somebody
 * else's behalf, so what matters here is that it lands completely — volumes,
 * contract value and the frozen baseline together — and that a revision cannot
 * be applied twice.
 */

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ path: '.env', quiet: true });

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

const probe = await probeSchema('CCO', async (db) => {
  const rows = await db`
    SELECT count(*)::int AS n FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('contract_revisions', 'contract_baselines')
  `;
  return rows[0]?.n === 2;
});

// A configured database that cannot be reached is a failure, not a skip:
// a suite that verified nothing must not look as though it had.
guardDatabase('CCO', probe);
const ready = probe.ready;

describe.skipIf(!ready)('pekerjaan tambah/kurang', () => {
  let sql: postgres.Sql;
  let service: typeof RevisionsModule;

  const orgId = randomUUID();
  const userId = randomUUID();
  const projectId = randomUUID();
  const unitId = randomUUID();
  const itemA = randomUUID();
  const itemB = randomUUID();

  const user: SessionUser = {
    id: userId,
    orgId,
    email: `cco-${userId}@uji.test`,
    fullName: 'Manajer Uji',
    globalRole: 'ADMIN',
  };

  /*
   * Both items carry a contract unit price, so their value does not depend on
   * an AHSP the fixture would otherwise have to build. 100 × 1.000.000 plus
   * 200 × 500.000 is 200 juta, which is also the declared contract value.
   */
  const buildFixture = async (): Promise<void> => {
    await sql.unsafe(
      [
        'BEGIN',
        "SELECT set_config('app.bypass_rls', 'on', true)",
        "SELECT set_config('app.allow_hard_delete', 'on', true)",
        `DELETE FROM projects WHERE org_id = '${orgId}'`,
        `DELETE FROM units WHERE org_id = '${orgId}'`,
        `DELETE FROM users WHERE org_id = '${orgId}'`,
        `DELETE FROM organizations WHERE id = '${orgId}'`,
        `INSERT INTO organizations (id, name) VALUES ('${orgId}', 'Org CCO (uji)')`,
        `INSERT INTO users (id, org_id, email, full_name, global_role)
           VALUES ('${userId}', '${orgId}', '${user.email}', '${user.fullName}', 'ADMIN')`,
        `INSERT INTO units (id, org_id, code, name, dimension)
           VALUES ('${unitId}', '${orgId}', 'm3', 'meter kubik', 'VOLUME')`,
        `INSERT INTO projects (id, org_id, code, name, start_date, end_date, contract_value)
           VALUES ('${projectId}', '${orgId}', 'CCO-1', 'Proyek CCO',
                   '2026-01-01', '2026-12-31', 200000000)`,
        `INSERT INTO project_members (project_id, user_id, role)
           VALUES ('${projectId}', '${userId}', 'PROJECT_MANAGER')`,
        `INSERT INTO work_items (id, project_id, code, name, unit_id, volume, contract_unit_price, sort_order)
           VALUES ('${itemA}', '${projectId}', 'A.01', 'Galian', '${unitId}', 100, 1000000, 0)`,
        `INSERT INTO work_items (id, project_id, code, name, unit_id, volume, contract_unit_price, sort_order)
           VALUES ('${itemB}', '${projectId}', 'A.02', 'Urugan', '${unitId}', 200, 500000, 1)`,
        'COMMIT',
      ].join(';\n'),
    ).simple();
  };

  beforeAll(async () => {
    sql = postgres(connectionOptions(url!, { max: 1, prepare: false, onnotice: () => {} }));
    service = await import('../contract-revisions');
  });

  beforeEach(buildFixture);

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

  const draft = (lines: { workItemId: string; volumeAfter: string }[]) =>
    service.createRevision(user, projectId, {
      title: 'Penyesuaian volume lapangan',
      reason: 'Berita acara uji',
      effectiveDate: '2026-05-01',
      scheduleImpactDays: 0,
      lines: lines.map((line) => ({ ...line, note: null })),
    });

  it('memberi nomor berurutan mulai CCO-01', async () => {
    await draft([{ workItemId: itemA, volumeAfter: '120' }]);
    await draft([{ workItemId: itemB, volumeAfter: '180' }]);

    const rows = await service.listRevisions(userId, projectId);
    expect(rows.map((row) => row.code)).toEqual(['CCO-02', 'CCO-01']);
    // Counted per revision, not across all of them.
    expect(rows.map((row) => row.lineCount)).toEqual([1, 1]);
  });

  it('menghitung nilai tambah dan kurang sebelum disetujui', async () => {
    const { id } = await draft([
      { workItemId: itemA, volumeAfter: '120' },
      { workItemId: itemB, volumeAfter: '180' },
    ]);

    const detail = await service.getRevision(userId, projectId, id);

    // +20 m3 × 1.000.000, dan −20 m3 × 500.000.
    expect(detail.summary.addedValue).toBe('20000000.00');
    expect(detail.summary.removedValue).toBe('10000000.00');
    expect(detail.summary.netValue).toBe('10000000.00');
    expect(detail.summary.contractValueAfter).toBe('210000000.00');
    expect(detail.status).toBe('DRAFT');
  });

  // A draft must not move anything: that is the whole difference between a
  // proposal and an addendum.
  it('tidak mengubah apa pun selama masih draf', async () => {
    await draft([{ workItemId: itemA, volumeAfter: '120' }]);

    const [item] = await sql<{ volume: string }[]>`
      SELECT volume::text FROM work_items WHERE id = ${itemA}
    `;
    const [project] = await sql<{ contract_value: string }[]>`
      SELECT contract_value::text FROM projects WHERE id = ${projectId}
    `;

    expect(Number(item?.volume)).toBe(100);
    expect(Number(project?.contract_value)).toBe(200000000);
  });

  it('menulis volume dan nilai kontrak saat disetujui', async () => {
    const { id } = await draft([
      { workItemId: itemA, volumeAfter: '120' },
      { workItemId: itemB, volumeAfter: '180' },
    ]);

    await service.approveRevision(user, projectId, id);

    const items = await sql<{ id: string; volume: string }[]>`
      SELECT id, volume::text FROM work_items WHERE project_id = ${projectId} ORDER BY code
    `;
    expect(Number(items[0]?.volume)).toBe(120);
    expect(Number(items[1]?.volume)).toBe(180);

    const [project] = await sql<{ contract_value: string }[]>`
      SELECT contract_value::text FROM projects WHERE id = ${projectId}
    `;
    expect(Number(project?.contract_value)).toBe(210000000);
  });

  /*
   * Baseline 0 has to be taken before the first approval or it can never be
   * taken honestly again. Approving without one freezes it first.
   */
  it('mengunci Baseline 0 otomatis pada persetujuan pertama', async () => {
    expect(await service.getContractBaseline(userId, projectId)).toBeNull();

    const { id } = await draft([{ workItemId: itemA, volumeAfter: '120' }]);
    await service.approveRevision(user, projectId, id);

    const baseline = await service.getContractBaseline(userId, projectId);
    expect(baseline?.itemCount).toBe(2);
    // The value frozen is the one before the revision, not after it.
    expect(Number(baseline?.contractValue)).toBe(200000000);
  });

  it('membandingkan lingkup awal terhadap keadaan sekarang', async () => {
    const { id } = await draft([{ workItemId: itemA, volumeAfter: '120' }]);
    await service.approveRevision(user, projectId, id);

    const comparison = await service.getScopeComparison(userId, projectId);
    const galian = comparison.rows.find((row) => row.code === 'A.01');

    expect(comparison.hasBaseline).toBe(true);
    expect(Number(galian?.baselineVolume)).toBe(100);
    expect(Number(galian?.currentVolume)).toBe(120);
    expect(galian?.valueDelta).toBe('20000000.00');
    expect(comparison.totals.valueDelta).toBe('20000000.00');
  });

  it('menolak menyetujui revisi yang sama dua kali', async () => {
    const { id } = await draft([{ workItemId: itemA, volumeAfter: '120' }]);
    await service.approveRevision(user, projectId, id);

    await expect(service.approveRevision(user, projectId, id)).rejects.toThrow(/sudah disetujui/);

    const [item] = await sql<{ volume: string }[]>`
      SELECT volume::text FROM work_items WHERE id = ${itemA}
    `;
    expect(Number(item?.volume)).toBe(120);
  });

  it('menolak menghapus revisi yang sudah disetujui', async () => {
    const { id } = await draft([{ workItemId: itemA, volumeAfter: '120' }]);
    await service.approveRevision(user, projectId, id);

    await expect(service.deleteRevision(user, projectId, id)).rejects.toThrow(/tidak dapat dihapus/);
  });

  /*
   * Zeroing a work item is how a job is removed from the contract. It stays in
   * the breakdown at zero rather than disappearing, so the addendum can still
   * show what was dropped and by how much.
   */
  it('menolkan pekerjaan yang tidak jadi dikerjakan', async () => {
    const { id } = await draft([{ workItemId: itemB, volumeAfter: '0' }]);
    const detail = await service.getRevision(userId, projectId, id);
    expect(detail.lines[0]?.kind).toBe('REMOVE');

    await service.approveRevision(user, projectId, id);

    const [item] = await sql<{ volume: string }[]>`
      SELECT volume::text FROM work_items WHERE id = ${itemB}
    `;
    expect(Number(item?.volume)).toBe(0);

    const [project] = await sql<{ contract_value: string }[]>`
      SELECT contract_value::text FROM projects WHERE id = ${projectId}
    `;
    expect(Number(project?.contract_value)).toBe(100000000);
  });

  // Baseline 0 is a fixed point. Refreezing it would erase what every later
  // comparison is measured against.
  it('menolak mengunci Baseline 0 dua kali', async () => {
    await service.freezeContractBaseline(user, projectId, null);
    await expect(service.freezeContractBaseline(user, projectId, null)).rejects.toThrow(
      /sudah dikunci/,
    );
  });

  it('menolak revisi tanpa satu pun baris', async () => {
    await expect(
      service.createRevision(user, projectId, {
        title: 'Kosong',
        reason: null,
        effectiveDate: '2026-05-01',
      scheduleImpactDays: 0,
        lines: [],
      }),
    ).rejects.toThrow(/setidaknya satu pekerjaan/);
  });

  /*
   * Time, not only money.
   *
   * Work added to a contract usually adds time to it, and the extension is
   * what a delay claim rests on. The dates on either side are stored at the
   * moment of approval for the same reason the contract values are: a revision
   * approved in March has to keep saying what the programme was in March.
   */
  describe('dampak waktu', () => {
    const draftWithDays = (days: number) =>
      service.createRevision(user, projectId, {
        title: 'Tambah pekerjaan galian',
        reason: 'Kondisi tanah',
        effectiveDate: '2026-05-01',
        scheduleImpactDays: days,
        lines: [{ workItemId: itemA, volumeAfter: '150', note: null }],
      });

    const finishDate = async (): Promise<string> => {
      const [row] = await sql<{ end_date: string }[]>`
        SELECT end_date::text FROM projects WHERE id = ${projectId}
      `;
      return row!.end_date;
    };

    it('memajukan tanggal selesai proyek sebanyak hari yang disetujui', async () => {
      const { id } = await draftWithDays(30);
      const result = await service.approveRevision(user, projectId, id);

      // 31 Desember plus 30 hari jatuh di 30 Januari tahun berikutnya.
      expect(result.finishDateBefore).toBe('2026-12-31');
      expect(result.finishDateAfter).toBe('2027-01-30');
      expect(await finishDate()).toBe('2027-01-30');
    });

    it('menyimpan kedua tanggal pada revisinya sendiri', async () => {
      const { id } = await draftWithDays(14);
      await service.approveRevision(user, projectId, id);

      const detail = await service.getRevision(userId, projectId, id);
      expect(detail.scheduleImpactDays).toBe(14);
      expect(detail.finishDateBefore).toBe('2026-12-31');
      expect(detail.finishDateAfter).toBe('2027-01-14');
    });

    it('tidak menyentuh tanggal selesai bila revisinya tidak meminta waktu', async () => {
      const { id } = await draftWithDays(0);
      await service.approveRevision(user, projectId, id);
      expect(await finishDate()).toBe('2026-12-31');
    });

    /*
     * Removing work can legitimately pull a programme in. Refusing to record
     * that would leave the only documented way of shortening a contract
     * missing from the system that documents the contract.
     */
    it('memundurkan tanggal selesai bila pekerjaannya dipercepat', async () => {
      const { id } = await draftWithDays(-10);
      await service.approveRevision(user, projectId, id);
      expect(await finishDate()).toBe('2026-12-21');
    });
  });
});
