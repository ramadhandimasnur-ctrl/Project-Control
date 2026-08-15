import 'server-only';

import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';

import { db } from '@/db';
import { withUser } from '@/db/context';
import { projectMembers, projects, users } from '@/db/schema';
import { canDeleteProject, canEditContractTerms, type ProjectRole } from '@/lib/auth/roles';
import { conflict, forbidden, notFound } from '@/lib/errors';
import { type ProjectFormValues } from '@/lib/validation/project';

import { assertProjectAccess } from './access';
import { writeAuditLog } from './audit';
import { type SessionUser } from './session';

export type ProjectListItem = {
  id: string;
  code: string;
  name: string;
  location: string | null;
  contractValue: string;
  startDate: string;
  endDate: string;
  status: 'DRAFT' | 'ACTIVE' | 'ON_HOLD' | 'CLOSED';
  role: ProjectRole;
  memberCount: number;
};

/**
 * Projects the user may open: those they are a member of, plus — for a global
 * administrator — every project in their own organisation.
 */
export async function listProjects(user: SessionUser): Promise<ProjectListItem[]> {
  const memberCount = db.$with('member_count').as(
    db
      .select({
        projectId: projectMembers.projectId,
        total: sql<number>`count(*)::int`.as('total'),
      })
      .from(projectMembers)
      .groupBy(projectMembers.projectId),
  );

  const rows = await db
    .with(memberCount)
    .select({
      id: projects.id,
      code: projects.code,
      name: projects.name,
      location: projects.location,
      contractValue: projects.contractValue,
      startDate: projects.startDate,
      endDate: projects.endDate,
      status: projects.status,
      memberRole: projectMembers.role,
      memberCount: memberCount.total,
    })
    .from(projects)
    .leftJoin(
      projectMembers,
      and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, user.id)),
    )
    .leftJoin(memberCount, eq(memberCount.projectId, projects.id))
    .where(
      and(
        eq(projects.orgId, user.orgId),
        user.globalRole === 'ADMIN' ? undefined : eq(projectMembers.userId, user.id),
      ),
    )
    .orderBy(asc(projects.code));

  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    location: r.location,
    contractValue: r.contractValue,
    startDate: r.startDate,
    endDate: r.endDate,
    status: r.status,
    role: r.memberRole ?? 'ADMIN',
    memberCount: r.memberCount ?? 0,
  }));
}

export type ProjectDetail = typeof projects.$inferSelect & { role: ProjectRole };

export async function getProject(userId: string, projectId: string): Promise<ProjectDetail> {
  const access = await assertProjectAccess(userId, projectId, 'VIEWER');

  const [row] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!row) throw notFound('Proyek tidak ditemukan.');

  return { ...row, role: access.role };
}

/**
 * Creates a project and enrols its creator in one transaction.
 *
 * The membership row is not optional: without it a non-admin creator would
 * immediately lose access to what they just made.
 */
export async function createProject(
  user: SessionUser,
  values: ProjectFormValues,
): Promise<{ id: string }> {
  const [duplicate] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.orgId, user.orgId), eq(projects.code, values.code)))
    .limit(1);

  if (duplicate) {
    throw conflict(
      `Kode proyek "${values.code}" sudah dipakai.`,
      'Gunakan kode lain, misalnya dengan menambahkan tahun di belakangnya.',
    );
  }

  // Bound to the acting user: `audit_logs` and every other project-scoped
  // table enforces row-level security, which needs `app.current_user_id` set.
  return withUser(user.id, async (tx) => {
    const [created] = await tx
      .insert(projects)
      .values({ ...values, orgId: user.orgId, createdBy: user.id, updatedBy: user.id })
      .returning({ id: projects.id });

    if (!created) throw conflict('Proyek gagal dibuat.');

    await tx.insert(projectMembers).values({
      projectId: created.id,
      userId: user.id,
      role: 'PROJECT_MANAGER',
      createdBy: user.id,
      updatedBy: user.id,
    });

    await writeAuditLog(tx, {
      orgId: user.orgId,
      projectId: created.id,
      tableName: 'projects',
      recordId: created.id,
      action: 'INSERT',
      after: values,
      actorId: user.id,
    });

    return { id: created.id };
  });
}

export async function updateProject(
  user: SessionUser,
  projectId: string,
  values: ProjectFormValues,
): Promise<void> {
  const access = await assertProjectAccess(user.id, projectId, 'ENGINEER');

  const [before] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!before) throw notFound('Proyek tidak ditemukan.');

  // Commercial fields are gated separately from engineering fields: an
  // ENGINEER may maintain the project sheet but not restate the contract.
  const touchesCommercials =
    before.contractValue !== values.contractValue ||
    before.retentionPercent !== values.retentionPercent ||
    before.vatPercent !== values.vatPercent ||
    before.whtPercent !== values.whtPercent;

  if (touchesCommercials && !canEditContractTerms(access.role)) {
    throw forbidden(
      'Nilai kontrak, retensi, dan tarif pajak hanya dapat diubah oleh Manajer Proyek.',
      'Ubah data lain terlebih dahulu, atau minta Manajer Proyek melakukan perubahan ini.',
    );
  }

  if (before.code !== values.code) {
    const [duplicate] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.orgId, before.orgId), eq(projects.code, values.code)))
      .limit(1);
    if (duplicate) {
      throw conflict(`Kode proyek "${values.code}" sudah dipakai.`, 'Gunakan kode lain.');
    }
  }

  await withUser(user.id, async (tx) => {
    await tx
      .update(projects)
      .set({ ...values, updatedBy: user.id })
      .where(eq(projects.id, projectId));

    await writeAuditLog(tx, {
      orgId: before.orgId,
      projectId,
      tableName: 'projects',
      recordId: projectId,
      action: 'UPDATE',
      before,
      after: values,
      actorId: user.id,
    });
  });
}

/**
 * Counts what a deletion would take with it, so the confirmation dialog can
 * state the consequence specifically rather than warning in the abstract
 * (charter section 7).
 */
export async function getProjectDeletionImpact(
  userId: string,
  projectId: string,
): Promise<{ workItems: number; progressEntries: number; materialTransactions: number; purchases: number }> {
  await assertProjectAccess(userId, projectId, 'PROJECT_MANAGER');

  // All four tables carry FORCE ROW LEVEL SECURITY. Counted outside a user
  // context they would every one of them return zero — a confirmation dialog
  // that understates what it is about to destroy.
  const [row] = await withUser(userId, (tx) =>
    tx.execute<{
      work_items: number;
      progress_entries: number;
      material_transactions: number;
      purchases: number;
    }>(sql`
      SELECT
        (SELECT count(*)::int FROM work_items            WHERE project_id = ${projectId}) AS work_items,
        (SELECT count(*)::int FROM progress_entries      WHERE project_id = ${projectId}) AS progress_entries,
        (SELECT count(*)::int FROM material_transactions WHERE project_id = ${projectId}) AS material_transactions,
        (SELECT count(*)::int FROM purchases             WHERE project_id = ${projectId}) AS purchases
    `),
  );

  return {
    workItems: row?.work_items ?? 0,
    progressEntries: row?.progress_entries ?? 0,
    materialTransactions: row?.material_transactions ?? 0,
    purchases: row?.purchases ?? 0,
  };
}

export async function deleteProject(user: SessionUser, projectId: string): Promise<void> {
  const access = await assertProjectAccess(user.id, projectId, 'PROJECT_MANAGER');

  if (!canDeleteProject(access.role)) {
    throw forbidden('Anda tidak berwenang menghapus proyek ini.');
  }

  const [before] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!before) throw notFound('Proyek tidak ditemukan.');

  await withUser(user.id, async (tx) => {
    // Removing the project cascades into the append-only ledgers, whose delete
    // triggers refuse ordinary deletes. This is the one sanctioned exception,
    // and it lasts only for this transaction.
    await tx.execute(sql`SELECT set_config('app.allow_hard_delete', 'on', true)`);

    // Written before the delete: the audit row references the project, and the
    // cascade would otherwise remove it along with everything else.
    await writeAuditLog(tx, {
      orgId: before.orgId,
      projectId: null,
      tableName: 'projects',
      recordId: projectId,
      action: 'DELETE',
      before,
      actorId: user.id,
    });

    await tx.delete(projects).where(eq(projects.id, projectId));
  });
}

/** Organisation members, for the "add member" picker. */
export async function listOrgUsers(
  orgId: string,
): Promise<{ id: string; fullName: string; email: string }[]> {
  return db
    .select({ id: users.id, fullName: users.fullName, email: users.email })
    .from(users)
    .where(and(eq(users.orgId, orgId), eq(users.isActive, true)))
    .orderBy(asc(users.fullName));
}

/** Used by the sidebar's project switcher. */
export async function listAccessibleProjectSummaries(
  user: SessionUser,
): Promise<{ id: string; code: string; name: string }[]> {
  const accessible = db
    .select({ projectId: projectMembers.projectId })
    .from(projectMembers)
    .where(eq(projectMembers.userId, user.id));

  return db
    .select({ id: projects.id, code: projects.code, name: projects.name })
    .from(projects)
    .where(
      and(
        eq(projects.orgId, user.orgId),
        user.globalRole === 'ADMIN' ? undefined : or(inArray(projects.id, accessible)),
      ),
    )
    .orderBy(asc(projects.code));
}
