import 'server-only';

import { and, asc, count, eq, ne } from 'drizzle-orm';

import { db } from '@/db';
import { withUser } from '@/db/context';
import { organizations, projectMembers, users } from '@/db/schema';
import { type GlobalRole } from '@/lib/auth/roles';
import { conflict, forbidden, notFound, validation } from '@/lib/errors';
import { sendAdminEmail } from '@/lib/notify/email';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { USER_STATUS_LABELS, type UserRow, type UserStatus } from '@/lib/users/labels';

import { writeAuditLog } from './audit';
import { assertOrgAccess } from './org-access';
import { type SessionUser } from './session';

/**
 * Accounts and who is allowed in.
 *
 * Registration no longer admits anyone by itself. A new sign-up lands as
 * PENDING and cannot obtain a session until an administrator approves it and
 * chooses its role — which is the only point at which anyone decides what a
 * stranger may see.
 *
 * The one exception is the very first account of an empty deployment. Someone
 * has to be able to approve the second, and an installation where nobody can
 * ever log in is not a safer installation, it is a broken one.
 */

// Vocabulary lives in lib/users/labels so client components can read it
// without importing this server-only module. Re-exported here so callers that
// are already on the server need only one import.
export { USER_STATUS_LABELS, type UserRow, type UserStatus };

export async function listUsers(userId: string): Promise<UserRow[]> {
  const access = await assertOrgAccess(userId, 'ADMIN');

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      username: users.username,
      globalRole: users.globalRole,
      status: users.status,
      createdAt: users.createdAt,
      reviewedAt: users.reviewedAt,
    })
    .from(users)
    // Removed accounts are gone as far as the screen is concerned; the row
    // survives only so that older records keep the name that produced them.
    .where(and(eq(users.orgId, access.orgId), ne(users.status, 'REMOVED')))
    .orderBy(asc(users.createdAt));

  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
  }));
}

/** Which organisation a new registration joins, and whether it bootstraps. */
export async function registrationTarget(): Promise<{
  orgId: string | null;
  isFirstAccount: boolean;
}> {
  const [existing] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .orderBy(asc(organizations.createdAt))
    .limit(1);

  if (!existing) return { orgId: null, isFirstAccount: true };

  const [tally] = await db.select({ value: count() }).from(users);
  return { orgId: existing.id, isFirstAccount: (tally?.value ?? 0) === 0 };
}

/**
 * Tells the administrator that someone is waiting.
 *
 * Never throws and never blocks the registration: the pending list is the
 * record that matters, and email is a convenience on top of it. The outcome is
 * returned so the caller can be honest with the registrant about whether a
 * human has actually been paged.
 */
export async function notifyPendingRegistration(input: {
  fullName: string;
  username: string | null;
  email: string;
}): Promise<void> {
  await sendAdminEmail({
    subject: `Pendaftaran baru menunggu persetujuan: ${input.fullName}`,
    text: [
      'Ada pendaftaran baru pada Project Control.',
      '',
      `Nama    : ${input.fullName}`,
      `Username: ${input.username ?? '-'}`,
      `Email   : ${input.email}`,
      '',
      'Akun ini belum dapat masuk sampai Anda menyetujuinya dan memilih perannya',
      'di halaman Pengguna.',
    ].join('\n'),
  });
}

export type ReviewDecision =
  | { decision: 'APPROVE'; globalRole: GlobalRole }
  | { decision: 'REJECT' }
  | { decision: 'DEACTIVATE' }
  | { decision: 'REACTIVATE' };

const NEXT_STATUS: Record<ReviewDecision['decision'], UserStatus> = {
  APPROVE: 'ACTIVE',
  REJECT: 'REJECTED',
  DEACTIVATE: 'DEACTIVATED',
  REACTIVATE: 'ACTIVE',
};

/**
 * Approves, rejects, deactivates or restores an account.
 *
 * `isActive` is written alongside `status` in the same statement. The database
 * has a check constraint tying them together, so a caller that forgets one is
 * rejected rather than quietly leaving a rejected account able to sign in.
 */
export async function reviewUser(
  actor: SessionUser,
  targetUserId: string,
  input: ReviewDecision,
): Promise<void> {
  const access = await assertOrgAccess(actor.id, 'ADMIN');

  if (targetUserId === actor.id) {
    throw forbidden(
      'Anda tidak dapat mengubah status akun Anda sendiri.',
      'Minta administrator lain melakukannya, agar tidak ada yang mengunci dirinya keluar.',
    );
  }

  const [target] = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      status: users.status,
      globalRole: users.globalRole,
      orgId: users.orgId,
    })
    .from(users)
    .where(eq(users.id, targetUserId))
    .limit(1);

  if (!target || target.orgId !== access.orgId) {
    throw notFound('Pengguna tidak ditemukan di organisasi ini.');
  }

  const status = NEXT_STATUS[input.decision];

  if (target.status === status && input.decision !== 'APPROVE') {
    throw conflict(`Akun ini sudah berstatus "${USER_STATUS_LABELS[status]}".`);
  }

  /*
   * The last administrator cannot be demoted or switched off. Without this an
   * organisation can be left with nobody able to approve anyone, and the only
   * way back in is a database console.
   */
  if (target.globalRole === 'ADMIN' && status !== 'ACTIVE') {
    await assertAnotherAdminRemains(access.orgId, targetUserId);
  }

  const nextRole = input.decision === 'APPROVE' ? input.globalRole : target.globalRole;

  if (target.globalRole === 'ADMIN' && nextRole !== 'ADMIN') {
    await assertAnotherAdminRemains(access.orgId, targetUserId);
  }

  await withUser(actor.id, async (tx) => {
    await tx
      .update(users)
      .set({
        status,
        isActive: status === 'ACTIVE',
        globalRole: nextRole,
        reviewedBy: actor.id,
        reviewedAt: new Date(),
      })
      .where(eq(users.id, targetUserId));

    await writeAuditLog(tx, {
      orgId: access.orgId,
      tableName: 'users',
      recordId: targetUserId,
      action: 'UPDATE',
      before: { status: target.status, globalRole: target.globalRole },
      after: { status, globalRole: nextRole },
      actorId: actor.id,
    });
  });
}

/**
 * Refuses to remove the last active administrator.
 *
 * Currently unreachable, and deliberately kept. The caller must itself be an
 * active administrator of the same organisation and is barred from targeting
 * its own row, so another active administrator — the actor — always remains.
 *
 * It stays because the day someone relaxes the self-modification rule is
 * exactly the day this becomes the only thing standing between the
 * organisation and nobody being able to approve anyone. One count query on an
 * admin-status change is a cheap place to keep that.
 */
async function assertAnotherAdminRemains(orgId: string, exceptUserId: string): Promise<void> {
  const [tally] = await db
    .select({ value: count() })
    .from(users)
    .where(
      and(
        eq(users.orgId, orgId),
        eq(users.globalRole, 'ADMIN'),
        eq(users.status, 'ACTIVE'),
        ne(users.id, exceptUserId),
      ),
    );

  if ((tally?.value ?? 0) === 0) {
    throw conflict(
      'Ini administrator aktif terakhir di organisasi.',
      'Angkat administrator lain terlebih dahulu, agar selalu ada yang dapat menyetujui pendaftaran.',
    );
  }
}

/** Changes a role without touching the approval status. */
export async function setGlobalRole(
  actor: SessionUser,
  targetUserId: string,
  globalRole: GlobalRole,
): Promise<void> {
  const access = await assertOrgAccess(actor.id, 'ADMIN');

  if (targetUserId === actor.id) {
    throw forbidden('Anda tidak dapat mengubah peran Anda sendiri.');
  }

  const [target] = await db
    .select({ id: users.id, globalRole: users.globalRole, orgId: users.orgId })
    .from(users)
    .where(eq(users.id, targetUserId))
    .limit(1);

  if (!target || target.orgId !== access.orgId) {
    throw notFound('Pengguna tidak ditemukan di organisasi ini.');
  }

  if (target.globalRole === globalRole) return;
  if (target.globalRole === 'ADMIN') await assertAnotherAdminRemains(access.orgId, targetUserId);

  await withUser(actor.id, async (tx) => {
    await tx.update(users).set({ globalRole }).where(eq(users.id, targetUserId));

    await writeAuditLog(tx, {
      orgId: access.orgId,
      tableName: 'users',
      recordId: targetUserId,
      action: 'UPDATE',
      before: { globalRole: target.globalRole },
      after: { globalRole },
      actorId: actor.id,
    });
  });
}

/**
 * Removes someone from the organisation.
 *
 * Distinct from deactivating, which suspends an account that still belongs
 * here: memberships and email survive, and switching it back on restores what
 * was there. Removing says they have left. Their project memberships go, and so
 * does the Supabase Auth credential — without that the address stays claimed
 * forever and the person keeps a password to an account nobody can see.
 *
 * The application row stays, marked REMOVED. Every table records `created_by`
 * and `updated_by` against it, and deleting the person would blank the
 * authorship of their progress entries, their purchases and the addenda they
 * approved. A traceability system that forgets who did the work has failed at
 * the one job it has.
 *
 * The auth account is deleted before the row is marked, deliberately. If the
 * credential survives a half-finished removal the person can still sign in; if
 * the row survives one, the worst case is a stale label an administrator can
 * see and fix.
 */
export async function removeUserFromOrg(
  actor: SessionUser,
  targetUserId: string,
): Promise<void> {
  const access = await assertOrgAccess(actor.id, 'ADMIN');

  if (targetUserId === actor.id) {
    throw forbidden(
      'Anda tidak dapat mengeluarkan akun Anda sendiri.',
      'Minta administrator lain melakukannya, agar tidak ada yang mengunci dirinya keluar.',
    );
  }

  const [target] = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      status: users.status,
      globalRole: users.globalRole,
      orgId: users.orgId,
    })
    .from(users)
    .where(eq(users.id, targetUserId))
    .limit(1);

  if (!target || target.orgId !== access.orgId) {
    throw notFound('Pengguna tidak ditemukan di organisasi ini.');
  }

  if (target.status === 'REMOVED') {
    throw conflict(`"${target.fullName}" sudah dikeluarkan dari organisasi.`);
  }

  // Same guard as deactivation: an organisation with no administrator left has
  // no way back in except a database console.
  if (target.globalRole === 'ADMIN') {
    await assertAnotherAdminRemains(access.orgId, targetUserId);
  }

  const memberships = await db
    .select({ projectId: projectMembers.projectId })
    .from(projectMembers)
    .where(eq(projectMembers.userId, targetUserId));

  /*
   * Best effort, and deliberately not fatal. An auth account that is already
   * gone — deleted by hand, or by an earlier attempt that failed later — must
   * not block the rest of the removal, or the row stays ACTIVE forever and the
   * screen keeps offering a button that cannot succeed.
   */
  let authDeleted = true;
  try {
    const { error } = await supabaseAdmin().auth.admin.deleteUser(targetUserId);
    if (error) authDeleted = false;
  } catch {
    authDeleted = false;
  }

  await withUser(actor.id, async (tx) => {
    await tx.delete(projectMembers).where(eq(projectMembers.userId, targetUserId));

    /*
     * The address is released, the row is not.
     *
     * A removed account has to disappear from the screen and has to stop
     * holding its email hostage — `users_email_unique` would otherwise refuse
     * to let the same person be invited back. Deleting the row would achieve
     * both, and would also blank `submitted_by`, `approved_by`, `checked_by`
     * and every `actor_id` in the audit log, because each of those is
     * `ON DELETE SET NULL`. Progress that somebody approved would quietly stop
     * saying who approved it, and that attribution is what a payment claim
     * rests on.
     *
     * So the address is moved aside to a reserved-by-RFC domain that can never
     * receive mail, the name stays where history refers to it, and the row is
     * excluded from every listing. The original address is kept in the audit
     * entry below.
     */
    await tx
      .update(users)
      .set({
        status: 'REMOVED',
        isActive: false,
        email: `removed+${targetUserId}@removed.invalid`,
        username: null,
        reviewedBy: actor.id,
        reviewedAt: new Date(),
      })
      .where(eq(users.id, targetUserId));

    await writeAuditLog(tx, {
      orgId: access.orgId,
      tableName: 'users',
      recordId: targetUserId,
      action: 'UPDATE',
      before: { status: target.status, email: target.email, projectCount: memberships.length },
      after: { status: 'REMOVED', projectCount: 0, authDeleted },
      actorId: actor.id,
    });
  });
}

/** Rejects a username already taken, before Supabase creates an auth user. */
export async function assertUsernameAvailable(username: string): Promise<void> {
  const trimmed = username.trim();
  if (trimmed === '') throw validation('Username wajib diisi.');

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, trimmed))
    .limit(1);

  if (existing) throw conflict(`Username "${trimmed}" sudah dipakai.`);
}
