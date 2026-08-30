import { Lock } from 'lucide-react';
import type { Metadata } from 'next';

import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { SubcontractBoard } from '@/features/subcontracts/subcontract-board';
import { canEditContractTerms } from '@/lib/auth/roles';
import { getProject } from '@/services/projects';
import { listPeriods } from '@/services/schedule';
import { requireSessionUser } from '@/services/session';
import { getSubcontract, listSubcontracts } from '@/services/subcontracts';
import { listUnits } from '@/services/units';
import { listWorkItems } from '@/services/work-breakdown';

export const metadata: Metadata = { title: 'Borongan & Mandor' };

export default async function SubcontractsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sub?: string }>;
}) {
  const [{ id: projectId }, query] = await Promise.all([params, searchParams]);
  const user = await requireSessionUser();
  const project = await getProject(user.id, projectId);

  const [{ rows, showCosts }, workItems, units, periods] = await Promise.all([
    listSubcontracts(user.id, projectId),
    listWorkItems(user.id, projectId),
    listUnits(user.id),
    listPeriods(user.id, projectId),
  ]);

  if (!showCosts) {
    return (
      <div className="p-6">
        <EmptyState
          icon={Lock}
          title="Halaman ini memuat angka biaya"
          description="Peran Anda pada proyek ini tidak diberi akses ke harga, biaya, dan margin."
        />
      </div>
    );
  }

  /*
   * The chosen contract, or the first one. A page that opens on nothing makes
   * the reader click before it says anything, and there is almost always one
   * contract that matters most.
   */
  const chosenId = query.sub ?? rows[0]?.id;
  const selected =
    chosenId === undefined ? null : await getSubcontract(user.id, projectId, chosenId).catch(() => null);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Borongan & Mandor"
        description="Kontrak, kasbon, dan sertifikat pengukuran. Nilai yang disertifikasi dibandingkan dengan anggaran upah RAP untuk pekerjaan yang sama — itu yang menjawab apakah diborongkan lebih murah daripada dikerjakan sendiri."
      />

      <SubcontractBoard
        projectId={projectId}
        rows={rows}
        selected={selected}
        workItems={workItems.map((item) => ({ id: item.id, code: item.code, name: item.name }))}
        units={units.map((unit) => ({ id: unit.id, code: unit.code, name: unit.name }))}
        periods={periods.map((period) => ({ id: period.id, label: period.label }))}
        canManage={canEditContractTerms(project.role)}
      />
    </div>
  );
}
