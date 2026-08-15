import type { Metadata } from 'next';

import { PageHeader } from '@/components/page-header';
import { canManageMembers } from '@/lib/auth/roles';
import { listMembers } from '@/services/members';
import { getProject, listOrgUsers } from '@/services/projects';
import { requireSessionUser } from '@/services/session';

import { MembersManager } from './members-manager';

export const metadata: Metadata = { title: 'Anggota Proyek' };

export default async function MembersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireSessionUser();

  const project = await getProject(user.id, id);
  const members = await listMembers(user.id, id);
  const canManage = canManageMembers(project.role);
  const orgUsers = canManage ? await listOrgUsers(user.orgId) : [];

  const assignable = orgUsers.filter((u) => !members.some((m) => m.userId === u.id));

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-6">
      <PageHeader
        title="Anggota proyek"
        description="Peran menentukan apa yang dapat dilihat dan diubah seseorang di proyek ini. Aturan ini ditegakkan di server."
      />
      <MembersManager
        projectId={project.id}
        members={members}
        assignableUsers={assignable}
        canManage={canManage}
        currentUserId={user.id}
      />
    </div>
  );
}
