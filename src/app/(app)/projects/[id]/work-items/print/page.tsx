import type { Metadata } from 'next';

import { PageHeader } from '@/components/page-header';
import { PaperSettings } from '@/features/progress/paper-settings';
import { SignatureBlock } from '@/features/reports/signature-block';
import { AhspPrintSheet } from '@/features/work-items/ahsp-print-sheet';
import { formatDateTime } from '@/lib/format';
import { listWorkItemAnalyses } from '@/services/ahsp';
import { getProject } from '@/services/projects';
import { requireSessionUser } from '@/services/session';
import { listSignatories } from '@/services/signatories';

export const metadata: Metadata = { title: 'Cetak AHSP' };

/**
 * Both analyses of every work item, in one printable document.
 *
 * One file rather than two exports: RAB and RAP are read against each other,
 * and a reader holding only one of them cannot answer the question an AHSP
 * sheet exists to answer. `?item=` narrows it to a single work item for the
 * common case of reprinting one analysis after a correction.
 */
export default async function AhspPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ item?: string }>;
}) {
  const { id: projectId } = await params;
  const { item: requestedItem } = await searchParams;

  const user = await requireSessionUser();

  const [project, analyses, signatories] = await Promise.all([
    getProject(user.id, projectId),
    listWorkItemAnalyses(user.id, projectId, { workItemId: requestedItem }),
    listSignatories(user.id, projectId),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-6">
      <div data-print="hide" className="space-y-4">
        <PageHeader
          title="Cetak AHSP"
          description={
            requestedItem === undefined
              ? `Analisa harga satuan seluruh ${analyses.items.length} pekerjaan, RAB dan RAP dalam satu berkas.`
              : 'Analisa harga satuan satu pekerjaan, RAB dan RAP dalam satu berkas.'
          }
        />

        <div className="rounded-lg border p-3">
          <PaperSettings previewSelector="#ahsp-sheet" />
        </div>
      </div>

      <div id="ahsp-sheet" className="print-full mx-auto w-full space-y-6">
        <header data-print="keep-together" className="space-y-1 border-b pb-4">
          <h1 className="text-xl font-semibold">Analisa Harga Satuan Pekerjaan</h1>
          <p className="text-sm">
            <span className="font-mono text-muted-foreground">{project.code}</span> · {project.name}
            {project.location ? ` · ${project.location}` : ''}
          </p>
          <p className="text-xs text-muted-foreground">
            Dicetak {formatDateTime(new Date())} · harga yang berlaku pada tanggal cetak
          </p>
        </header>

        {analyses.items.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
            Belum ada pekerjaan untuk dicetak.
          </p>
        ) : (
          analyses.items.map((item, index) => (
            <AhspPrintSheet
              key={item.workItemId}
              item={item}
              showCosts={analyses.showCosts}
              pageBreak={index > 0}
            />
          ))
        )}

        <SignatureBlock signatories={signatories} />
      </div>
    </div>
  );
}
