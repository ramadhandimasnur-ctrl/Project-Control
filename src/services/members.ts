import 'server-only';

import { and, asc, eq, inArray } from 'drizzle-orm';

import { db } from '@/db';
import { withUser } from '@/db/context';
import { projectMembers, users } from '@/db/schema';
import { PROJECT_ROLE_LABELS, type ProjectRole } from '@/lib/auth/roles';
import { conflict, notFound, validation } from '@/lib/errors';

import { assertProjectAccess } from './access';
import { writeAuditLog } from './audit';
import { type SessionUser } from './session';

export type ProjectMemberRow = {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  role: ProjectRole;
};

/** Roles that can still administer the project if everyone else is removed. */
const STEWARD_ROLES: readonly ProjectRole[] = ['ADMIN', 'PROJECT_MANAGER'];

export async function listMembers(
  userId: string,
  projectId: string,
): Promise<ProjectMemberRow[]> {
  await assertProjectAccess(userId, projectId, 'VIEWER');

  return db
    .select({
      id: projectMembers.id,
      userId: users.id,
      fullName: users.fullName,
      email: users.email,
      role: projectMembers.role,
    })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(eq(projectMembers.projectId, projectId))
    .orderBy(asc(users.fullName));
}

export async function addMember(
  actor: SessionUser,
  projectId: string,
  userId: string,
  role: ProjectRole,
): Promise<void> {
  const access = await assertProjectAccess(actor.id, projectId, 'PROJECT_MANAGER');

  const [target] = await db
    .select({ id: users.id, orgId: users.orgId, fullName: users.fullName, isActive: users.isActive })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!target || !target.isActive || target.orgId !== access.orgId) {
    throw notFound(
      'Pengguna tidak ditemukan di organisasi ini.',
      'Pastikan pengguna sudah terdaftar dan aktif.',
    );
  }

  const [existing] = await db
    .select({ id: projectMembers.id })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .limit(1);

  if (existing) {
    throw conflict(
      `${target.fullName} sudah menjadi anggota proyek ini.`,
      'Ubah perannya lewat daftar anggota bila perlu.',
    );
  }

  await withUser(actor.id, async (tx) => {
    const [created] = await tx
      .insert(projectMembers)
      .values({ projectId, userId, role, createdBy: actor.id, updatedBy: actor.id })
      .returning({ id: projectMembers.id });

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'project_members',
      recordId: created?.id ?? null,
      action: 'INSERT',
      after: { userId, role },
      actorId: actor.id,
    });
  });
}

export async function changeMemberRole(
  actor: SessionUser,
  projectId: string,
  memberId: string,
  role: ProjectRole,
): Promise<void> {
  const access = await assertProjectAccess(actor.id, projectId, 'PROJECT_MANAGER');

  const [member] = await db
    .select({
      id: projectMembers.id,
      userId: projectMembers.userId,
      role: projectMembers.role,
      fullName: users.fullName,
    })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(and(eq(projectMembers.id, memberId), eq(projectMembers.projectId, projectId)))
    .limit(1);

  if (!member) throw notFound('Anggota tidak ditemukan pada proyek ini.');
  if (member.role === role) return;

  await assertProjectKeepsSteward(projectId, member.id, role);

  await withUser(actor.id, async (tx) => {
    await tx
      .update(projectMembers)
      .set({ role, updatedBy: actor.id })
      .where(eq(projectMembers.id, memberId));

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'project_members',
      recordId: memberId,
      action: 'UPDATE',
      before: { role: member.role },
      after: { role },
      actorId: actor.id,
    });
  });
}

export async function removeMember(
  actor: SessionUser,
  projectId: string,
  memberId: string,
): Promise<void> {
  const access = await assertProjectAccess(actor.id, projectId, 'PROJECT_MANAGER');

  const [member] = await db
    .select({
      id: projectMembers.id,
      userId: projectMembers.userId,
      role: projectMembers.role,
      fullName: users.fullName,
    })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(and(eq(projectMembers.id, memberId), eq(projectMembers.projectId, projectId)))
    .limit(1);

  if (!member) throw notFound('Anggota tidak ditemukan pada proyek ini.');

  await assertProjectKeepsSteward(projectId, member.id, null);

  await withUser(actor.id, async (tx) => {
    await tx.delete(projectMembers).where(eq(projectMembers.id, memberId));

    await writeAuditLog(tx, {
      orgId: access.orgId,
      projectId,
      tableName: 'project_members',
      recordId: memberId,
      action: 'DELETE',
      before: { userId: member.userId, role: member.role },
      actorId: actor.id,
    });
  });
}

/**
 * Refuses any change that would leave the project with nobody able to approve
 * progress or manage members. Locking everyone out of a live project is not a
 * recoverable mistake for a non-administrator.
 *
 * `nextRole` is the role the member is moving to, or null when being removed.
 */
async function assertProjectKeepsSteward(
  projectId: string,
  memberId: string,
  nextRole: ProjectRole | null,
): Promise<void> {
  if (nextRole !== null && STEWARD_ROLES.includes(nextRole)) return;

  const stewards = await db
    .select({ id: projectMembers.id })
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        inArray(projectMembers.role, [...STEWARD_ROLES]),
      ),
    );

  const remaining = stewards.filter((s) => s.id !== memberId);
  if (remaining.length === 0) {
    throw validation(
      `Proyek harus memiliki minimal satu ${PROJECT_ROLE_LABELS.PROJECT_MANAGER}.`,
      'Tetapkan anggota lain sebagai Manajer Proyek terlebih dahulu.',
    );
  }
}
