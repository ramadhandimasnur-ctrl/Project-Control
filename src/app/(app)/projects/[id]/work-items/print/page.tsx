import { TriangleAlert } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/page-header';
import { PaperSettings } from '@/features/progress/paper-settings';
import { SignatureBlock } from '@/features/reports/signature-block';
import { AhspPrintSheet } from '@/features/work-items/ahsp-print-sheet';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { EstimateType } from '@/services/ahsp';
import { listWorkItemAnalyses } from '@/services/ahsp';
import { getProject } from '@/services/projects';
import { requireSessionUser } from '@/services/session';
import { listSignatories } from '@/services/signatories';

export const metadata: Metadata = { title: 'Cetak AHSP' };

/**
 * The analyses, printable — in the version the reader is entitled to.
 *
 * These used to print together always. On screen that is right: the question a
 * reader has in front of an AHSP sheet is what the gap between RAB and RAP is
 * and where it comes from. On paper it is a leak waiting to happen, because
 * the RAP side carries execution prices and therefore the margin, and a stack
 * handed to the client is handed over whole.
 *
 * So the version is chosen deliberately, the safe one is the default, and
 * anything carrying execution prices says so on every sheet — in print, not
 * only on screen, because the screen is not what gets handed over.
 */

type Version = 'rab' | 'rap' | 'keduanya';

const VERSIONS: Record<Version, { label: string; hint: string; versions: EstimateType[] }> = {
  rab: {
    label: 'RAB — untuk pemberi kerja',
    hint: 'Analisa harga satuan versi anggaran. Aman diserahkan.',
    versions: ['RAB'],
  },
  rap: {
    label: 'RAP — internal',
    hint: 'Analisa harga pelaksanaan. Jangan diserahkan ke pemberi kerja.',
    versions: ['RAP'],
  },
  keduanya: {
    label: 'RAB & RAP — internal',
    hint: 'Kedua analisa berdampingan beserta selisihnya. Jangan diserahkan ke pemberi kerja.',
    versions: ['RAB', 'RAP'],
  },
};

const isVersion = (value: string | undefined): value is Version =>
  value === 'rab' || value === 'rap' || value === 'keduanya';

export default async function AhspPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ item?: string; versi?: string }>;
}) {
  const { id: projectId } = await params;
  const { item: requestedItem, versi } = await searchParams;

  /*
   * RAB unless asked otherwise. The default of a document that can be printed
   * and handed over has to be the version that is safe to hand over; anything
   * else makes a mistake the cheapest thing to do.
   */
  const chosen: Version = isVersion(versi) ? versi : 'rab';
  const { versions, hint } = VERSIONS[chosen];
  const internal = versions.includes('RAP');

  const user = await requireSessionUser();

  const [project, analyses, signatories] = await Promise.all([
    getProject(user.id, projectId),
    listWorkItemAnalyses(user.id, projectId, { workItemId: requestedItem }),
    listSignatories(user.id, projectId),
  ]);

  const hrefFor = (version: Version) => {
    const params = new URLSearchParams();
    if (requestedItem !== undefined) params.set('item', requestedItem);
    params.set('versi', version);
    return `/projects/${projectId}/work-items/print?${params.toString()}`;
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-6">
      <div data-print="hide" className="space-y-4">
        <PageHeader
          title="Cetak AHSP"
          description={
            requestedItem === undefined
              ? `Analisa harga satuan seluruh ${analyses.items.length} pekerjaan.`
              : 'Analisa harga satuan satu pekerjaan.'
          }
        />

        <div className="space-y-3 rounded-lg border p-3">
          <div className="space-y-2">
            <p className="text-sm font-medium">Versi yang dicetak</p>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(VERSIONS) as Version[]).map((version) => (
                <Link
                  key={version}
                  href={hrefFor(version)}
                  aria-current={chosen === version ? 'page' : undefined}
                  className={cn(
                    'rounded-md border px-3 py-1.5 text-sm transition-colors',
                    chosen === version
                      ? 'border-foreground bg-foreground text-background'
                      : 'hover:bg-accent',
                  )}
                >
                  {VERSIONS[version].label}
                </Link>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{hint}</p>
          </div>

          <PaperSettings previewSelector="#ahsp-sheet" />
        </div>
      </div>

      <div id="ahsp-sheet" className="print-full mx-auto w-full space-y-6">
        <header data-print="keep-together" className="space-y-1 border-b pb-4">
          <h1 className="text-xl font-semibold">
            Analisa Harga Satuan Pekerjaan
            {internal && !versions.includes('RAB') ? ' — Versi Pelaksanaan (RAP)' : ''}
          </h1>
          <p className="text-sm">
            <span className="font-mono text-muted-foreground">{project.code}</span> · {project.name}
            {project.location ? ` · ${project.location}` : ''}
          </p>
          <p className="text-xs text-muted-foreground">
            Dicetak {formatDateTime(new Date())} · harga yang berlaku pada tanggal cetak
          </p>
        </header>

        {/*
          Deliberately not `data-print="hide"`. The danger is the printed stack,
          not the screen, so the warning has to survive onto the paper — and it
          repeats in the footer because a reader may only ever see page nine.
        */}
        {internal ? (
          <p
            data-print="keep-together"
            className="flex items-start gap-2 rounded-md border-2 border-destructive p-3 text-sm font-medium text-destructive"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              DOKUMEN INTERNAL — memuat harga pelaksanaan (RAP) dan marginnya. Jangan diserahkan
              kepada pemberi kerja. Versi yang boleh diserahkan adalah cetakan RAB.
            </span>
          </p>
        ) : null}

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
              versions={versions}
            />
          ))
        )}

        <SignatureBlock signatories={signatories} />

        {internal ? (
          <p className="border-t pt-3 text-center text-xs font-medium text-destructive">
            DOKUMEN INTERNAL — harga pelaksanaan (RAP). Jangan diserahkan kepada pemberi kerja.
          </p>
        ) : null}
      </div>
    </div>
  );
}
