import type { Metadata } from 'next';

import { PageHeader } from '@/components/page-header';
import { CentralWarehouseManager } from '@/features/master-data/central-warehouse-manager';
import { getCentralStock, listCentralWarehouses } from '@/services/central-warehouse';
import { assertOrgAccess } from '@/services/org-access';
import { listAccessibleProjectSummaries } from '@/services/projects';
import { listResources } from '@/services/resources';
import { requireSessionUser } from '@/services/session';

export const metadata: Metadata = { title: 'Gudang Pusat' };

export default async function CentralWarehousePage({
  searchParams,
}: {
  searchParams: Promise<{ wh?: string }>;
}) {
  const { wh } = await searchParams;
  const user = await requireSessionUser();

  const [warehouses, access, catalogue, projects] = await Promise.all([
    listCentralWarehouses(user.id),
    assertOrgAccess(user.id),
    listResources(user.id, { limit: 500 }),
    listAccessibleProjectSummaries(user),
  ]);

  const selectedId = wh ?? warehouses[0]?.id ?? null;
  const stock =
    selectedId === null ? [] : (await getCentralStock(user.id, selectedId).catch(() => null))?.rows ?? [];

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Gudang Pusat"
        description="Gudang milik organisasi, bukan milik satu proyek. Material dibeli sekali dalam jumlah besar lalu dibagikan ke proyek sesuai kebutuhan, pada harga rata-rata tertimbang yang benar-benar dibayar."
      />

      <CentralWarehouseManager
        warehouses={warehouses}
        selected={selectedId}
        stock={stock}
        resources={catalogue.items.map((r) => ({ id: r.id, code: r.code, name: r.name }))}
        projects={projects.map((p) => ({ id: p.id, code: p.code, name: p.name }))}
        canManage={access.globalRole === 'ADMIN'}
      />
    </div>
  );
}
