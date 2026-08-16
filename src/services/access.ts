import 'server-only';

import { and, eq } from 'drizzle-orm';
import { cache } from 'react';

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
  const access = await resolveProjectAccess(userId, projectId);

  if (!hasAtLeast(access.role, minRole)) {
    throw forbidden(
      `Tindakan ini memerlukan peran ${PROJECT_ROLE_LABELS[minRole]}, sedangkan peran Anda ${PROJECT_ROLE_LABELS[access.role]}.`,
      'Hubungi manajer proyek bila Anda memang memerlukan akses ini.',
    );
  }

  return access;
}

/**
 * Who this user is on this project: one query, once per request.
 *
 * Split from the assertion above because the two do different jobs and only
 * one of them can be memoised. The threshold varies per call site — the same
 * page asks for VIEWER to read and ENGINEER to decide whether to offer an edit
 * button — so caching the assertion would key on `minRole` and dedupe nothing.
 * What cannot change within a request is who this person is here, and that is
 * what is cached.
 *
 * It matters because every function in `services/` opens with this check. A
 * page calling six of them paid eighteen round trips re-answering a question
 * whose answer cannot change mid-render, and at ~100 ms to the pooler that was
 * most of what made a page feel slow.
 *
 * One statement rather than three for the same reason: the user row, the
 * project row and the membership row are wanted together or not at all, and
 * asking in sequence spends two round trips waiting to ask questions it could
 * have asked at the start.
 *
 * The explicit type annotation is not decoration. `cache()` is generic, and
 * without it TypeScript widens a `Promise.all([...])` tuple containing this
 * call to `any[]` — every sibling in the tuple silently loses its type.
 */
export const resolveProjectAccess: (
  userId: string,
  projectId: string,
) => Promise<ProjectAccess> = cache(async (userId: string, projectId: string) => {
  const [row] = await db
    .select({
      userOrgId: users.orgId,
      globalRole: users.globalRole,
      isActive: users.isActive,
      projectId: projects.id,
      projectOrgId: projects.orgId,
      projectName: projects.name,
      membershipRole: projectMembers.role,
    })
    .from(users)
    .leftJoin(projects, eq(projects.id, projectId))
    .leftJoin(
      projectMembers,
      and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)),
    )
    .where(eq(users.id, userId))
    .limit(1);

  if (!row || !row.isActive) throw unauthenticated();

  if (row.projectId === null || row.projectOrgId !== row.userOrgId) {
    throw notFound(
      'Proyek tidak ditemukan.',
      'Proyek mungkin sudah dihapus, atau Anda tidak memiliki akses ke proyek ini.',
    );
  }

  const isGlobalAdmin = row.globalRole === 'ADMIN';
  const role: ProjectRole | null = row.membershipRole ?? (isGlobalAdmin ? 'ADMIN' : null);

  if (!role) {
    throw forbidden(
      `Anda bukan anggota proyek "${row.projectName}".`,
      'Minta manajer proyek menambahkan Anda sebagai anggota.',
    );
  }

  return {
    projectId,
    userId,
    orgId: row.userOrgId,
    role,
    viaGlobalAdmin: row.membershipRole === null && isGlobalAdmin,
  };
});

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
