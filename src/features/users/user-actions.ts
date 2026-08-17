'use server';

import { revalidatePath } from 'next/cache';

import { type GlobalRole } from '@/lib/auth/roles';
import { toUserMessage } from '@/lib/errors';
import { requireSessionUser } from '@/services/session';
import {
  removeUserFromOrg,
  reviewUser,
  setGlobalRole,
  type ReviewDecision,
} from '@/services/users';

export type ActionResult = { ok: true } | { ok: false; message: string; hint?: string };

function failure(error: unknown): { ok: false; message: string; hint?: string } {
  const { message, hint } = toUserMessage(error);
  return hint === undefined ? { ok: false, message } : { ok: false, message, hint };
}

const DECISIONS = ['APPROVE', 'REJECT', 'DEACTIVATE', 'REACTIVATE'] as const;
const ROLES: GlobalRole[] = ['ADMIN', 'MEMBER'];

export async function reviewUserAction(
  targetUserId: string,
  decision: string,
  globalRole?: string,
): Promise<ActionResult> {
  if (!(DECISIONS as readonly string[]).includes(decision)) {
    return { ok: false, message: 'Keputusan tidak dikenal.' };
  }

  if (decision === 'APPROVE' && !ROLES.includes(globalRole as GlobalRole)) {
    return { ok: false, message: 'Peran wajib dipilih saat menyetujui.' };
  }

  const input =
    decision === 'APPROVE'
      ? ({ decision: 'APPROVE', globalRole: globalRole as GlobalRole } satisfies ReviewDecision)
      : ({ decision } as ReviewDecision);

  try {
    const user = await requireSessionUser();
    await reviewUser(user, targetUserId, input);
  } catch (error) {
    return failure(error);
  }

  revalidatePath('/users');
  return { ok: true };
}

export async function setGlobalRoleAction(
  targetUserId: string,
  globalRole: string,
): Promise<ActionResult> {
  if (!ROLES.includes(globalRole as GlobalRole)) {
    return { ok: false, message: 'Peran tidak dikenal.' };
  }

  try {
    const user = await requireSessionUser();
    await setGlobalRole(user, targetUserId, globalRole as GlobalRole);
  } catch (error) {
    return failure(error);
  }

  revalidatePath('/users');
  return { ok: true };
}

/**
 * Removes someone from the organisation entirely.
 *
 * Separate from `reviewUserAction` because it is a different kind of act, not
 * a heavier setting on the same dial: memberships are dropped and the sign-in
 * credential is deleted. Giving it its own action keeps the confirmation copy
 * and the audit entry honest about which one happened.
 */
export async function removeUserAction(targetUserId: string): Promise<ActionResult> {
  try {
    const user = await requireSessionUser();
    await removeUserFromOrg(user, targetUserId);
  } catch (error) {
    return failure(error);
  }

  revalidatePath('/users');
  return { ok: true };
}
