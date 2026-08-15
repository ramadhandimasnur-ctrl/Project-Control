import 'server-only';

import { and, eq } from 'drizzle-orm';

import { db } from '@/db';
import { projectMembers, projects, users } from '@/db/schema';
import {
  hasAtLeast,
  PROJECT_ROLE_LABELS,
  type ProjectRole,
} from '@/lib/auth/roles';
import { forbidden, notFound, unauthenticated } from '@/lib/errors';

export type ProjectAccess = {
  projectId: string;
  userId: string;
  orgId: string;
  /** The role actually in force, after resolving global administrators. */
  role: ProjectRole;
  /** True when access comes from `users.global_role = 'ADMIN'`, not membership. */
  viaGlobalAdmin: boolean;
};

/**
 * The single authorisation gate for project data.
 *
 * Charter section 3: every function in `services/` begins with this call. It
 * is the authority; row-level security is a backstop behind it, and the UI
 * merely reflects what it decides.
 *
 * A project in another organisation reports NOT_FOUND rather than FORBIDDEN —
 * confirming that a project id exists is itself a leak.
 */
export async function assertProjectAccess(
  userId: string,
  projectId: string,
  minRole: ProjectRole,
): Promise<ProjectAccess> {
  const [user] = await db
    .select({
      id: users.id,
      orgId: users.orgId,
      globalRole: users.globalRole,
      isActive: users.isActive,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user || !user.isActive) throw unauthenticated();

  const [project] = await db
    .select({ id: projects.id, orgId: projects.orgId, name: projects.name })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project || project.orgId !== user.orgId) {
    throw notFound(
      'Proyek tidak ditemukan.',
      'Proyek mungkin sudah dihapus, atau Anda tidak memiliki akses ke proyek ini.',
    );
  }

  const [membership] = await db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .limit(1);

  const isGlobalAdmin = user.globalRole === 'ADMIN';
  const role: ProjectRole | null = membership?.role ?? (isGlobalAdmin ? 'ADMIN' : null);

  if (!role) {
    throw forbidden(
      `Anda bukan anggota proyek "${project.name}".`,
      'Minta manajer proyek menambahkan Anda sebagai anggota.',
    );
  }

  if (!hasAtLeast(role, minRole)) {
    throw forbidden(
      `Tindakan ini memerlukan peran ${PROJECT_ROLE_LABELS[minRole]}, sedangkan peran Anda ${PROJECT_ROLE_LABELS[role]}.`,
      'Hubungi manajer proyek bila Anda memang memerlukan akses ini.',
    );
  }

  return {
    projectId,
    userId,
    orgId: user.orgId,
    role,
    viaGlobalAdmin: !membership && isGlobalAdmin,
  };
}

/**
 * Non-throwing variant, for rendering decisions where "no access" is a normal
 * outcome rather than an error.
 */
export async function getProjectRole(
  userId: string,
  projectId: string,
): Promise<ProjectRole | null> {
  try {
    const access = await assertProjectAccess(userId, projectId, 'VIEWER');
    return access.role;
  } catch {
    return null;
  }
}
