import { Lock } from 'lucide-react';
import type { Metadata } from 'next';

import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { DailyLaborBoard } from '@/features/labor/daily-labor-board';
import { canEditProjectData } from '@/lib/auth/roles';
import { listDailyLabor, listForemen } from '@/services/daily-labor';
import { getProject } from '@/services/projects';
import { listPeriods } from '@/services/schedule';
import { requireSessionUser } from '@/services/session';
import { listWorkItems } from '@/services/work-breakdown';

export const metadata: Metadata = { title: 'Upah Harian' };

export default async function DailyLaborPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const user = await requireSessionUser();
  const project = await getProject(user.id, projectId);

  const [labor, foremen, periods, workItems] = await Promise.all([
    listDailyLabor(user.id, projectId),
    listForemen(user.id),
    listPeriods(user.id, projectId),
    listWorkItems(user.id, projectId),
  ]);

  if (!labor.showCosts) {
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

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Upah Harian"
        description="Tenaga yang dibayar per orang per hari, bukan per volume terukur. Hari kerjanya dibagi ke pekerjaan menurut hari-orang, dan biayanya mendarat sendiri di Kendali Biaya."
      />

      <DailyLaborBoard
        projectId={projectId}
        rows={labor.rows}
        totals={labor.totals}
        foremen={foremen.map((f) => ({ id: f.id, code: f.code, name: f.name }))}
        periods={periods.map((p) => ({ id: p.id, label: p.label }))}
        workItems={workItems.map((w) => ({ id: w.id, code: w.code, name: w.name }))}
        canEdit={canEditProjectData(project.role)}
      />
    </div>
  );
}
