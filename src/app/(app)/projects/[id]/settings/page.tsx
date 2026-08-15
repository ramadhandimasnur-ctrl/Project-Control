import type { Metadata } from 'next';

import { PageHeader } from '@/components/page-header';
import { canEditContractTerms, canEditProjectData } from '@/lib/auth/roles';
import { Decimal } from '@/lib/calc/decimal';
import { type ProjectFormInput } from '@/lib/validation/project';
import { getProject, getProjectDeletionImpact } from '@/services/projects';
import { requireSessionUser } from '@/services/session';

import { ProjectSettingsForm } from './project-settings-form';

export const metadata: Metadata = { title: 'Pengaturan Proyek' };

/** Fractions come out of the database as 0..1; the form edits them as 0..100. */
function toPercentInput(fraction: string): string {
  return new Decimal(fraction).times(100).toDecimalPlaces(6).toString();
}

export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireSessionUser();
  const project = await getProject(user.id, id);

  const defaults: ProjectFormInput = {
    code: project.code,
    name: project.name,
    contractNo: project.contractNo ?? '',
    ownerName: project.ownerName ?? '',
    contractorName: project.contractorName ?? '',
    location: project.location ?? '',
    projectType: project.projectType ?? '',
    contractValue: project.contractValue,
    startDate: project.startDate,
    endDate: project.endDate,
    periodType: project.periodType,
    durationUnit: project.durationUnit,
    retentionPercent: toPercentInput(project.retentionPercent),
    retentionReleaseDays: project.retentionReleaseDays,
    vatPercent: toPercentInput(project.vatPercent),
    whtPercent: toPercentInput(project.whtPercent),
    progressWeightBasis: project.progressWeightBasis,
    costRecognition: project.costRecognition,
    defaultMarkup: toPercentInput(project.defaultMarkup),
    thresholdWarning: toPercentInput(project.thresholdWarning),
    thresholdDelayed: toPercentInput(project.thresholdDelayed),
    requireChecklistBeforeApprove: project.requireChecklistBeforeApprove,
    allowNegativeStock: project.allowNegativeStock,
    status: project.status,
    notes: project.notes ?? '',
  };

  const canEdit = canEditProjectData(project.role);
  const impact = canEdit ? await getProjectDeletionImpact(user.id, id).catch(() => null) : null;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-6">
      <PageHeader
        title="Pengaturan proyek"
        description="Nilai kontrak, retensi, tarif pajak, dan aturan pengendalian berlaku untuk proyek ini saja."
      />
      <ProjectSettingsForm
        projectId={project.id}
        projectName={project.name}
        defaultValues={defaults}
        canEdit={canEdit}
        canEditContractTerms={canEditContractTerms(project.role)}
        deletionImpact={impact}
      />
    </div>
  );
}
