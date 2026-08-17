import { randomUUID } from 'node:crypto';

import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { connectionOptions } from '@/db/connection';
import type * as UsersModule from '../users';
import type { SessionUser } from '../session';

/**
 * Who is allowed in, and who decides.
 *
 * The rules worth testing are the ones that only bite in the awkward cases: an
 * administrator locking themselves out, the last administrator being demoted,
 * and the status/active pair drifting apart.
 */

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ path: '.env', quiet: true });

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

async function schemaIsReady(): Promise<boolean> {
  if (!url) return false;
  const probe = postgres(connectionOptions(url, { max: 1, prepare: false, connect_timeout: 5 }));
  try {
    const rows = await probe`
      SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_name = 'users' AND column_name IN ('status', 'username', 'reviewed_by')
    `;
    return rows[0]?.n === 3;
  } catch {
    return false;
  } finally {
    await probe.end();
  }
}

const ready = await schemaIsReady();
if (!ready) console.warn('[Pengguna] Dilewati: kolom persetujuan belum ada.');

describe.skipIf(!ready)('Persetujuan pengguna', () => {
  let sql: postgres.Sql;
  let service: typeof UsersModule;

  const orgId = randomUUID();
  const adminId = randomUUID();
  const secondAdminId = randomUUID();
  const pendingId = randomUUID();
  const memberId = randomUUID();

  const admin: SessionUser = {
    id: adminId,
    orgId,
    email: `admin-${adminId}@uji.test`,
    fullName: 'Admin Uji',
    globalRole: 'ADMIN',
  };

  const buildFixture = async (): Promise<void> => {
    await sql.unsafe(`
      BEGIN;
      SELECT set_config('app.bypass_rls', 'on', true);
      SELECT set_config('app.allow_hard_delete', 'on', true);
      DELETE FROM users WHERE org_id = '${orgId}';
      DELETE FROM organizations WHERE id = '${orgId}';

      INSERT INTO organizations (id, name) VALUES ('${orgId}', 'Org Pengguna (uji)');

      INSERT INTO users (id, org_id, email, full_name, username, global_role, status, is_active)
        VALUES
          ('${adminId}', '${orgId}', '${admin.email}', 'Admin Uji', 'admin-uji-${adminId.slice(0, 8)}', 'ADMIN', 'ACTIVE', true),
          ('${pendingId}', '${orgId}', 'pending-${pendingId}@uji.test', 'Pendaftar Uji', 'pendaftar-${pendingId.slice(0, 8)}', 'MEMBER', 'PENDING', false),
          ('${memberId}', '${orgId}', 'member-${memberId}@uji.test', 'Anggota Uji', 'anggota-${memberId.slice(0, 8)}', 'MEMBER', 'ACTIVE', true);
      COMMIT;
    `).simple();
  };

  const addSecondAdmin = async (): Promise<void> => {
    await sql.unsafe(`
      BEGIN;
      SELECT set_config('app.bypass_rls', 'on', true);
      INSERT INTO users (id, org_id, email, full_name, global_role, status, is_active)
        VALUES ('${secondAdminId}', '${orgId}', 'admin2-${secondAdminId}@uji.test', 'Admin Kedua', 'ADMIN', 'ACTIVE', true);
      COMMIT;
    `).simple();
  };

  const statusOf = async (id: string) => {
    const [row] = await sql<{ status: string; is_active: boolean; global_role: string }[]>`
      SELECT status, is_active, global_role FROM users WHERE id = ${id}
    `;
    return row;
  };

  beforeAll(async () => {
    sql = postgres(connectionOptions(url!, { max: 1, prepare: false, onnotice: () => {} }));
    service = await import('../users');
  });

  beforeEach(() => buildFixture());

  afterAll(async () => {
    if (!sql) return;
    await sql.unsafe(`
      BEGIN;
      SELECT set_config('app.bypass_rls', 'on', true);
      SELECT set_config('app.allow_hard_delete', 'on', true);
      DELETE FROM users WHERE org_id = '${orgId}';
      DELETE FROM organizations WHERE id = '${orgId}';
      COMMIT;
    `).simple();
    await sql.end();
  });

  it('menyetujui pendaftar dan menetapkan perannya sekaligus', async () => {
    await service.reviewUser(admin, pendingId, { decision: 'APPROVE', globalRole: 'MEMBER' });

    const row = await statusOf(pendingId);
    expect(row?.status).toBe('ACTIVE');
    expect(row?.is_active).toBe(true);
    expect(row?.global_role).toBe('MEMBER');
  });

  it('dapat menyetujui langsung sebagai administrator', async () => {
    await service.reviewUser(admin, pendingId, { decision: 'APPROVE', globalRole: 'ADMIN' });
    expect((await statusOf(pendingId))?.global_role).toBe('ADMIN');
  });

  /*
   * Rejecting leaves the row so the same person cannot simply register again
   * with the same email and slip past — and so the decision stays visible.
   */
  it('menolak tanpa menghapus akunnya', async () => {
    await service.reviewUser(admin, pendingId, { decision: 'REJECT' });

    const row = await statusOf(pendingId);
    expect(row?.status).toBe('REJECTED');
    expect(row?.is_active).toBe(false);
  });

  it('menonaktifkan dan mengaktifkan kembali', async () => {
    await service.reviewUser(admin, memberId, { decision: 'DEACTIVATE' });
    expect((await statusOf(memberId))?.is_active).toBe(false);

    await service.reviewUser(admin, memberId, { decision: 'REACTIVATE' });
    expect((await statusOf(memberId))?.is_active).toBe(true);
  });

  /*
   * An administrator who switches off their own account is locked out with no
   * way back except a database console.
   */
  it('menolak administrator mengubah status akunnya sendiri', async () => {
    await expect(
      service.reviewUser(admin, adminId, { decision: 'DEACTIVATE' }),
    ).rejects.toThrow(/akun Anda sendiri/i);
  });

  it('menolak administrator mengubah perannya sendiri', async () => {
    await expect(service.setGlobalRole(admin, adminId, 'MEMBER')).rejects.toThrow(/peran Anda/i);
  });

  /*
   * What actually protects the organisation from losing every administrator is
   * the self-modification rule above, not the last-admin count: the actor must
   * be an active administrator and cannot target their own row, so one always
   * remains. This asserts the reachable half — a second administrator can be
   * demoted and deactivated freely, because the actor is still there.
   */
  it('mengizinkan menurunkan administrator lain selama pelakunya tetap ada', async () => {
    await service.reviewUser(admin, pendingId, { decision: 'APPROVE', globalRole: 'ADMIN' });
    await service.setGlobalRole(admin, pendingId, 'MEMBER');
    expect((await statusOf(pendingId))?.global_role).toBe('MEMBER');

    await addSecondAdmin();
    await service.reviewUser(admin, secondAdminId, { decision: 'DEACTIVATE' });
    expect((await statusOf(secondAdminId))?.is_active).toBe(false);

    // The acting administrator is untouched and still able to act.
    expect((await statusOf(adminId))?.is_active).toBe(true);
    expect((await statusOf(adminId))?.global_role).toBe('ADMIN');
  });

  /*
   * The database is the last line: status and is_active are written together,
   * and a row that claims to be rejected while still active is refused
   * outright rather than left to every future caller to get right.
   */
  it('menolak status dan is_active yang tidak sejalan', async () => {
    await expect(
      sql`UPDATE users SET status = 'REJECTED' WHERE id = ${memberId}`,
    ).rejects.toThrow(/users_status_matches_active/);
  });

  it('menolak keputusan atas pengguna organisasi lain', async () => {
    await expect(
      service.reviewUser(admin, randomUUID(), { decision: 'REJECT' }),
    ).rejects.toThrow(/tidak ditemukan/i);
  });

  /*
   * Removal is not a heavier deactivation. These assert the difference: the
   * project memberships go, the row stays so authorship survives, and the
   * guards that protect the organisation from locking itself out still hold.
   *
   * The Supabase Auth side is not asserted here. These fixtures exist only in
   * Postgres — they were never given auth accounts — and the service treats a
   * missing one as an already-finished job rather than a failure, which is
   * exactly the path this exercises.
   */
  describe('mengeluarkan dari organisasi', () => {
    const projectId = randomUUID();

    const giveMembership = async (userId: string): Promise<void> => {
      await sql.unsafe(`
        BEGIN;
        SELECT set_config('app.bypass_rls', 'on', true);
        DELETE FROM projects WHERE id = '${projectId}';
        INSERT INTO projects (id, org_id, code, name, start_date, end_date)
          VALUES ('${projectId}', '${orgId}', 'KICK-1', 'Proyek Uji Kick',
                  '2026-01-01', '2026-12-31');
        INSERT INTO project_members (project_id, user_id, role)
          VALUES ('${projectId}', '${userId}', 'ENGINEER');
        COMMIT;
      `).simple();
    };

    const membershipCount = async (userId: string): Promise<number> => {
      const [row] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM project_members WHERE user_id = ${userId}
      `;
      return row?.n ?? 0;
    };

    it('melepas keanggotaan proyek dan menandai akunnya dikeluarkan', async () => {
      await giveMembership(memberId);
      expect(await membershipCount(memberId)).toBe(1);

      await service.removeUserFromOrg(admin, memberId);

      const row = await statusOf(memberId);
      expect(row?.status).toBe('REMOVED');
      expect(row?.is_active).toBe(false);
      expect(await membershipCount(memberId)).toBe(0);
    });

    // The row is what every created_by and updated_by in the system points at.
    it('menyisakan barisnya agar jejak kepengarangan tetap utuh', async () => {
      await service.removeUserFromOrg(admin, memberId);

      const [row] = await sql<{ full_name: string }[]>`
        SELECT full_name FROM users WHERE id = ${memberId}
      `;
      expect(row?.full_name).toBe('Anggota Uji');
    });

    it('menolak mengeluarkan akun yang sudah dikeluarkan', async () => {
      await service.removeUserFromOrg(admin, memberId);
      await expect(service.removeUserFromOrg(admin, memberId)).rejects.toThrow(
        /sudah dikeluarkan/,
      );
    });

    it('menolak administrator mengeluarkan dirinya sendiri', async () => {
      await expect(service.removeUserFromOrg(admin, adminId)).rejects.toThrow(
        /tidak dapat mengeluarkan akun Anda sendiri/,
      );
    });

    it('menolak pengguna organisasi lain', async () => {
      await expect(service.removeUserFromOrg(admin, randomUUID())).rejects.toThrow(
        /tidak ditemukan/,
      );
    });

    it('mengizinkan mengeluarkan administrator lain selama pelakunya tetap ada', async () => {
      await addSecondAdmin();
      await service.removeUserFromOrg(admin, secondAdminId);
      expect((await statusOf(secondAdminId))?.status).toBe('REMOVED');
    });

    /*
     * After each test, not at the end of the block. The shared fixture rebuilds
     * by deleting the organisation, and projects reference it with RESTRICT —
     * one project left behind aborts that transaction, and every later test in
     * the file then fails on a wound this one opened.
     */
    afterEach(async () => {
      if (!sql) return;
      await sql.unsafe(`
        BEGIN;
        SELECT set_config('app.bypass_rls', 'on', true);
        SELECT set_config('app.allow_hard_delete', 'on', true);
        DELETE FROM projects WHERE id = '${projectId}';
        COMMIT;
      `).simple();
    });
  });

  it('menolak username yang sudah dipakai', async () => {
    const rows = await service.listUsers(adminId);
    const taken = rows.find((row) => row.id === memberId)?.username;
    expect(taken).toBeTruthy();

    await expect(service.assertUsernameAvailable(taken!)).rejects.toThrow(/sudah dipakai/i);
    await expect(service.assertUsernameAvailable('nama-yang-bebas')).resolves.toBeUndefined();
  });

  it('menampilkan pendaftar yang menunggu beserta statusnya', async () => {
    const rows = await service.listUsers(adminId);
    const pendingRow = rows.find((row) => row.id === pendingId);

    expect(pendingRow?.status).toBe('PENDING');
    expect(rows.filter((row) => row.status === 'ACTIVE')).toHaveLength(2);
  });

  it('menolak daftar pengguna bagi non-administrator', async () => {
    await expect(service.listUsers(memberId)).rejects.toThrow();
  });
});
