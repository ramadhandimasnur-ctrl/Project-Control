import type { Metadata } from 'next';

import { PageHeader } from '@/components/page-header';
import { UnitsTable } from '@/features/master-data/units-table';
import { assertOrgAccess } from '@/services/org-access';
import { requireSessionUser } from '@/services/session';
import { listUnits } from '@/services/units';

export const metadata: Metadata = { title: 'Satuan' };

export default async function UnitsPage() {
  const user = await requireSessionUser();
  const [units, access] = await Promise.all([listUnits(user.id), assertOrgAccess(user.id)]);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Satuan"
        description="Konversi hanya berlaku dalam dimensi yang sama. Satuan berbeda dimensi tidak pernah dicampur."
      />
      <UnitsTable units={units} canManage={access.globalRole === 'ADMIN'} />
    </div>
  );
}
