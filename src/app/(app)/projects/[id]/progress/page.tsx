import { ClipboardCheck, Info } from 'lucide-react';
import type { Metadata } from 'next';
import { Suspense } from 'react';

import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { ProgressBoardView } from '@/features/progress/progress-board';
import { canRecordFieldData } from '@/lib/auth/roles';
import { formatPercent } from '@/lib/format';
import { PROGRESS_STATUS_LABELS } from '@/lib/calc/progress';
import { getProgressBoard, getProgressComparison } from '@/services/progress';
import { getProject } from '@/services/projects';
import { requireSessionUser } from '@/services/session';

export const metadata: Metadata = { title: 'Input Progres' };

const STATUS_TONE = {
  AHEAD: 'text-primary',
  ON_TRACK: 'text-foreground',
  WARNING: 'text-amber-600 dark:text-amber-500',
  DELAYED: 'text-destructive',
} as const;

export default async function ProgressPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  const [{ id: projectId }, query] = await Promise.all([params, searchParams]);
  const user = await requireSessionUser();

  const project = await getProject(user.id, projectId);
  const canRecord = canRecordFieldData(project.role);

  const [board, comparison] = await Promise.all([
    getProgressBoard(user.id, projectId, query.period),
    getProgressComparison(user.id, projectId),
  ]);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Input Progres"
        description="Capaian dicatat per pekerjaan per periode, lalu diajukan untuk disetujui. Hanya yang disetujui yang menggerakkan kurva realisasi."
        actions={
          <ButtonLink variant="outline" href={`/projects/${projectId}/scurve`}>
            Kurva-S
          </ButtonLink>
        }
      />

      {board.periods.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="Belum ada periode"
          description="Progres dicatat per periode. Bangun kalender periode proyek terlebih dahulu."
          action={
            <ButtonLink href={`/projects/${projectId}/schedule`}>Buka Periode &amp; Jadwal</ButtonLink>
          }
        />
      ) : board.rows.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="Belum ada pekerjaan"
          description="Progres dicatat atas daftar pekerjaan. Susun pekerjaan beserta analisanya terlebih dahulu."
          action={
            <ButtonLink href={`/projects/${projectId}/work-items`}>
              Buka Pekerjaan &amp; AHSP
            </ButtonLink>
          }
        />
      ) : (
        <>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Periode terakhir dilaporkan" value={comparison.current.periodLabel ?? '—'} />
            <Stat label="Rencana kumulatif" value={formatPercent(comparison.current.plannedCumulative, 2)} />
            <Stat label="Realisasi kumulatif" value={formatPercent(comparison.current.actualCumulative, 2)} />
            <Stat
              label="Deviasi"
              value={formatPercent(comparison.current.deviation, 2)}
              caption={PROGRESS_STATUS_LABELS[comparison.current.status]}
              tone={STATUS_TONE[comparison.current.status]}
            />
          </dl>

          {!comparison.curveFromBaseline ? (
            <Alert>
              <Info className="size-4" aria-hidden />
              <AlertTitle>Deviasi dihitung terhadap rencana yang masih dapat berubah</AlertTitle>
              <AlertDescription>
                Proyek ini belum punya baseline aktif, sehingga acuan deviasinya bergeser setiap kali
                distribusi rencana diubah. Kunci baseline agar penyimpangan ini punya arti.
              </AlertDescription>
            </Alert>
          ) : null}

          {board.requireChecklist ? (
            <p className="text-xs text-muted-foreground">
              Proyek ini mewajibkan checklist mutu lulus sebelum progres dapat disetujui.{' '}
              <Badge variant="outline" className="text-[10px]">
                {board.pendingCount} menunggu keputusan
              </Badge>
            </p>
          ) : null}

          <Suspense fallback={<p className="text-sm text-muted-foreground">Memuat papan…</p>}>
            <ProgressBoardView projectId={projectId} board={board} canRecord={canRecord} />
          </Suspense>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  caption,
  tone,
}: {
  label: string;
  value: string;
  caption?: string;
  tone?: string;
}) {
  return (
    <div className="space-y-1 rounded-lg border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`font-mono text-lg font-semibold tabular-nums ${tone ?? ''}`}>{value}</dd>
      {caption ? <p className={`text-xs ${tone ?? 'text-muted-foreground'}`}>{caption}</p> : null}
    </div>
  );
}
