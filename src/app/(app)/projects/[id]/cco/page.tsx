import type { Metadata } from 'next';

import { PageHeader } from '@/components/page-header';
import { RevisionBoard } from '@/features/contract-revisions/revision-board';
import { canEditContractTerms, canEditProjectData } from '@/lib/auth/roles';
import { toDecimal } from '@/lib/calc/decimal';
import { todayIso } from '@/lib/date';
import { getProjectEstimate } from '@/services/ahsp';
import { getContractBaseline, listRevisions } from '@/services/contract-revisions';
import { getProject } from '@/services/projects';
import { requireSessionUser } from '@/services/session';

export const metadata: Metadata = { title: 'Pekerjaan Tambah/Kurang' };

/**
 * Change orders — pekerjaan tambah/kurang.
 *
 * The scope of a contract moves, and this is where it moves on purpose: a
 * numbered revision, drafted, priced and approved, rather than someone quietly
 * editing a volume on the work breakdown and leaving no way to prove what was
 * originally agreed.
 */
export default async function CcoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const user = await requireSessionUser();

  const [project, revisions, baseline, estimate] = await Promise.all([
    getProject(user.id, projectId),
    listRevisions(user.id, projectId),
    getContractBaseline(user.id, projectId),
    getProjectEstimate(user.id, projectId),
  ]);

  /*
   * The unit rate a change is priced at, derived from the item's own contract
   * value rather than stored. A revision that carried its own copy of the rate
   * would disagree with the estimate the moment a price moved.
   */
  const candidates = estimate.items.map((item) => {
    const volume = toDecimal(item.volume);
    return {
      workItemId: item.workItemId,
      code: item.code,
      name: item.name,
      unitCode: item.unitCode,
      volume: item.volume,
      unitValue: volume.isZero()
        ? '0'
        : toDecimal(item.contractValue).dividedBy(volume).toFixed(2),
    };
  });

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Pekerjaan Tambah/Kurang (CCO)"
        description="Revisi lingkup kontrak: menambah pekerjaan, mengubah volume, atau menolkan pekerjaan yang tidak jadi dikerjakan."
      />

      <RevisionBoard
        projectId={projectId}
        revisions={revisions}
        candidates={candidates}
        baseline={
          baseline === null
            ? null
            : {
                frozenAt: baseline.frozenAt,
                itemCount: baseline.itemCount,
                contractValue: baseline.contractValue,
              }
        }
        defaultEffectiveDate={todayIso()}
        canDraft={canEditProjectData(project.role)}
        canApprove={canEditContractTerms(project.role)}
      />
    </div>
  );
}
