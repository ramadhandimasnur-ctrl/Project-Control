import type { Metadata } from 'next';

import { PageHeader } from '@/components/page-header';
import { SuppliersTable } from '@/features/master-data/suppliers-table';
import { assertOrgAccess } from '@/services/org-access';
import { requireSessionUser } from '@/services/session';
import { listSuppliers } from '@/services/suppliers';

export const metadata: Metadata = { title: 'Pemasok' };

export default async function SuppliersPage() {
  const user = await requireSessionUser();
  const [suppliers, access] = await Promise.all([
    listSuppliers(user.id),
    assertOrgAccess(user.id),
  ]);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Pemasok"
        description="Termin kredit pemasok menggeser tanggal kas keluar pada proyeksi kebutuhan modal."
      />
      <SuppliersTable suppliers={suppliers} canManage={access.globalRole === 'ADMIN'} />
    </div>
  );
}
