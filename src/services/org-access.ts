import 'server-only';

import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { projectMembers, users } from '@/db/schema';
import { canViewCosts, type GlobalRole } from '@/lib/auth/roles';
import { forbidden, unauthenticated } from '@/lib/errors';

export type OrgAccess = {
  userId: string;
  orgId: string;
  globalRole: GlobalRole;
};

/**
 * Guard for organisation-level data: units, categories, resources, suppliers
 * and the price book.
 *
 * The project counterpart is `assertProjectAccess`. Master data has no project
 * to belong to, so membership cannot decide it; the organisation does.
 *
 * Charter section 3 gives the organisation catalogue to ADMIN. Reading is open
 * to every active member — an engineer building an AHSP has to be able to look
 * up a resource and its price — while changing the catalogue requires ADMIN,
 * because a renamed unit or a re-coded resource reaches every project at once.
 */
export async function assertOrgAccess(
  userId: string,
  minRole: GlobalRole = 'MEMBER',
): Promise<OrgAccess> {
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

  if (minRole === 'ADMIN' && user.globalRole !== 'ADMIN') {
    throw forbidden(
      'Perubahan master data hanya dapat dilakukan oleh administrator organisasi.',
      'Master data dipakai bersama oleh seluruh proyek, sehingga perubahannya dipusatkan. Hubungi administrator Anda.',
    );
  }

  return { userId: user.id, orgId: user.orgId, globalRole: user.globalRole };
}

/**
 * Whether the price book may be shown to this user at all.
 *
 * `canViewCosts` is a project role test, but the catalogue belongs to the
 * organisation, so there is no single project to ask about. A user who is a
 * FIELD_USER everywhere they are a member must not see prices here either —
 * otherwise the rule that hides costs from the site team is undone by a link
 * in the navigation.
 *
 * Charter rule 7: the columns are dropped on the server, not hidden with CSS.
 */
export async function canViewOrgCosts(userId: string): Promise<boolean> {
  const access = await assertOrgAccess(userId);
  if (access.globalRole === 'ADMIN') return true;

  const memberships = await db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(eq(projectMembers.userId, userId));

  // No membership at all: nothing to reveal, and nothing to justify revealing.
  return memberships.some((m) => canViewCosts(m.role));
}
