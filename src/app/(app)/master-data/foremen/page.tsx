import type { Metadata } from 'next';

import { PageHeader } from '@/components/page-header';
import { ForemenTable } from '@/features/master-data/foremen-table';
import { listForemen } from '@/services/daily-labor';
import { assertOrgAccess } from '@/services/org-access';
import { requireSessionUser } from '@/services/session';

export const metadata: Metadata = { title: 'Mandor' };

export default async function ForemenPage() {
  const user = await requireSessionUser();
  const [foremen, access] = await Promise.all([listForemen(user.id), assertOrgAccess(user.id)]);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Mandor"
        description="Satu catatan per mandor, dipakai kontrak borongan maupun upah harian. Nomor rekeningnya ada di sini supaya tidak dicari ulang tiap kali membayar."
      />
      <ForemenTable foremen={foremen} canManage={access.globalRole === 'ADMIN'} />
    </div>
  );
}
