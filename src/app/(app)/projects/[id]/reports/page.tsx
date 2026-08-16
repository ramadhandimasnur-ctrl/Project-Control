import { FileBarChart, FileSpreadsheet, Info, Printer } from 'lucide-react';
import type { Metadata } from 'next';

import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PeriodPicker } from '@/features/progress/period-picker';
import { DeleteIssueButton, IssueButton, PublishButton } from '@/features/reports/report-actions';
import { SnapshotTable } from '@/features/reports/snapshot-table';
import {
  canEditContractTerms,
  canEditProjectData,
  canRecordFieldData,
  canViewCosts,
} from '@/lib/auth/roles';
import { EMPTY_VALUE, formatDay } from '@/lib/format';
import { getProgressBoard } from '@/services/progress';
import { getProject } from '@/services/projects';
import { ISSUE_SEVERITY_LABELS, ISSUE_STATUS_LABELS } from '@/lib/reports/labels';
import { listIssues, listSnapshots } from '@/services/reports';
import { requireSessionUser } from '@/services/session';

export const metadata: Metadata = { title: 'Laporan' };

const SEVERITY_VARIANT = {
  LOW: 'outline',
  MEDIUM: 'secondary',
  HIGH: 'destructive',
} as const;

/**
 * The reporting hub.
 *
 * Two kinds of report live here and they are not the same thing. The printable
 * sheets and spreadsheet exports always show today's figures. A published
 * report is frozen at the moment it was issued — which is what makes it worth
 * handing to an owner.
 */
export default async function ReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  const [{ id: projectId }, query] = await Promise.all([params, searchParams]);
  const user = await requireSessionUser();

  const project = await getProject(user.id, projectId);
  const canPublish = canEditProjectData(project.role);
  const canRecord = canRecordFieldData(project.role);
  const showCosts = canViewCosts(project.role);
  /*
   * Withdrawing sits a rung above publishing. Issuing a report is routine;
   * pulling one that has already gone out with an invoice is commercial.
   */
  const canWithdrawReports = canEditContractTerms(project.role);

  const [board, snapshots, openIssues] = await Promise.all([
    getProgressBoard(user.id, projectId, query.period),
    listSnapshots(user.id, projectId),
    listIssues(user.id, projectId),
  ]);

  const period = board.periods.find((p) => p.id === board.selectedPeriodId) ?? null;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Laporan"
        description="Lembar cetak dan ekspor selalu menampilkan angka hari ini. Laporan yang diterbitkan dibekukan pada saat penerbitannya."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <IssueButton projectId={projectId} periodId={period?.id ?? null} canRecord={canRecord} />
            <PublishButton
              projectId={projectId}
              periodId={period?.id ?? null}
              periodLabel={period?.label ?? null}
              canPublish={canPublish}
            />
          </div>
        }
      />

      {board.periods.length === 0 ? (
        <EmptyState
          icon={FileBarChart}
          title="Belum ada periode"
          description="Laporan disusun per periode proyek. Bangun kalender periodenya terlebih dahulu."
          action={
            <ButtonLink href={`/projects/${projectId}/schedule`}>Buka Periode &amp; Jadwal</ButtonLink>
          }
        />
      ) : (
        <>
          <PeriodPicker
            basePath={`/projects/${projectId}/reports`}
            periods={board.periods}
            selectedId={period?.id ?? ''}
            label="Periode laporan"
          />

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Lembar &amp; ekspor</h2>
            <p className="text-xs text-muted-foreground">
              Selalu dihitung ulang dari data terkini. Cocok untuk kerja harian; untuk yang
              diserahkan ke pemberi kerja, terbitkan laporan agar angkanya terkunci.
            </p>
            <div className="flex flex-wrap gap-2">
              {/*
                Both carry the period chosen just above. Without it the sheet
                and the spreadsheet would quietly describe a different period
                from the one on screen.
              */}
              <ButtonLink
                variant="outline"
                href={`/projects/${projectId}/reports/opname${period ? `?period=${period.id}` : ''}`}
              >
                <Printer className="size-4" aria-hidden />
                Laporan opname (cetak)
              </ButtonLink>
              <ButtonLink
                variant="outline"
                href={`/projects/${projectId}/exports/progress${period ? `?period=${period.id}` : ''}`}
              >
                <FileSpreadsheet className="size-4" aria-hidden />
                Rekap progres
              </ButtonLink>
              {showCosts ? (
                <>
                  <ButtonLink variant="outline" href={`/projects/${projectId}/exports/cashflow`}>
                    <FileSpreadsheet className="size-4" aria-hidden />
                    Arus kas
                  </ButtonLink>
                  <ButtonLink variant="outline" href={`/projects/${projectId}/exports/finance`}>
                    <FileSpreadsheet className="size-4" aria-hidden />
                    RAB/RAP/Realisasi
                  </ButtonLink>
                </>
              ) : null}
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Laporan terbit</h2>
            {snapshots.length === 0 ? (
              <Alert>
                <Info className="size-4" aria-hidden />
                <AlertTitle>Belum ada laporan yang diterbitkan</AlertTitle>
                <AlertDescription>
                  Menerbitkan laporan membekukan angkanya. Koreksi yang dibuat setelahnya tidak
                  mengubah laporan yang sudah terbit, sehingga apa yang dibaca pemberi kerja bulan
                  lalu tetap sama bulan ini.
                </AlertDescription>
              </Alert>
            ) : (
              <SnapshotTable
                projectId={projectId}
                snapshots={snapshots}
                canDelete={canWithdrawReports}
              />
            )}
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Kendala lapangan</h2>
            {openIssues.length === 0 ? (
              <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                Belum ada kendala yang dicatat.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Kendala</TableHead>
                      <TableHead className="w-24">Tingkat</TableHead>
                      <TableHead className="w-28">Status</TableHead>
                      <TableHead className="w-32">Periode</TableHead>
                      {canPublish ? <TableHead className="w-12" /> : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {openIssues.map((issue) => (
                      <TableRow key={issue.id}>
                        <TableCell>
                          <span className="font-medium">{issue.title}</span>
                          {issue.description ? (
                            <span className="block text-xs text-muted-foreground">
                              {issue.description}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={SEVERITY_VARIANT[issue.severity]}
                            className="text-[10px]"
                          >
                            {ISSUE_SEVERITY_LABELS[issue.severity]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {ISSUE_STATUS_LABELS[issue.status]}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {board.periods.find((p) => p.id === issue.periodId)?.label ??
                            EMPTY_VALUE}
                        </TableCell>
                        {canPublish ? (
                          <TableCell>
                            <DeleteIssueButton
                              projectId={projectId}
                              issueId={issue.id}
                              title={issue.title}
                              canManage={canPublish}
                            />
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>

          {period ? (
            <p className="text-xs text-muted-foreground">
              Periode terpilih {period.label} · {formatDay(period.startDate)} –{' '}
              {formatDay(period.endDate)}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
