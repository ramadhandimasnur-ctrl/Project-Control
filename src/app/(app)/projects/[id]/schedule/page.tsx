import { CalendarRange, Info } from 'lucide-react';
import type { Metadata } from 'next';

import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { BaselineButton, BaselineList } from '@/features/schedule/baseline-actions';
import { DistributionMatrix } from '@/features/schedule/distribution-matrix';
import { GanttChart } from '@/features/schedule/gantt-chart';
import { PeriodSettings } from '@/features/schedule/period-settings';
import { WorkCalendarPanel } from '@/features/schedule/work-calendar-panel';
import { canEditContractTerms, canEditProjectData } from '@/lib/auth/roles';
import { formatDay } from '@/lib/format';
import { PERIOD_TYPE_LABELS } from '@/lib/validation/schedule';
import { getProject } from '@/services/projects';
import { getScheduleOverview, listBaselines, listHolidays } from '@/services/schedule';
import { requireSessionUser } from '@/services/session';

export const metadata: Metadata = { title: 'Periode & Jadwal' };

export default async function SchedulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const user = await requireSessionUser();

  const project = await getProject(user.id, projectId);
  const canEdit = canEditProjectData(project.role);
  // Locking a baseline fixes what progress is judged against, so it sits with
  // the same authority as contract terms.
  const canManageBaseline = canEditContractTerms(project.role);

  const [overview, baselines, holidays] = await Promise.all([
    getScheduleOverview(user.id, projectId),
    listBaselines(user.id, projectId),
    listHolidays(user.id, projectId),
  ]);

  const codeOf = new Map(overview.rows.map((row) => [row.workItemId, row.code]));
  const incompleteCodes = overview.incomplete.map(
    (check) => codeOf.get(check.workItemId) ?? check.workItemId,
  );

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Periode & Jadwal"
        description="Bobot tiap pekerjaan disebar ke periode. Jumlah tiap baris harus tepat 100% sebelum baseline dapat dikunci."
        actions={
          <div className="flex items-center gap-2">
            <PeriodSettings
              projectId={projectId}
              periodType={overview.periodType}
              projectStart={overview.projectStart}
              projectEnd={overview.projectEnd}
              hasPeriods={overview.periods.length > 0}
              canEdit={canEdit}
            />
            <BaselineButton
              projectId={projectId}
              canManage={canManageBaseline}
              incompleteCodes={incompleteCodes}
              hasPeriods={overview.periods.length > 0}
            />
          </div>
        }
      />

      {overview.rows.length === 0 ? (
        <EmptyState
          icon={CalendarRange}
          title="Belum ada pekerjaan untuk dijadwalkan"
          description="Jadwal disusun atas daftar pekerjaan dan bobotnya. Susun pekerjaan beserta analisanya terlebih dahulu."
          action={
            <ButtonLink href={`/projects/${projectId}/work-items`}>
              Buka Pekerjaan &amp; AHSP
            </ButtonLink>
          }
        />
      ) : overview.periods.length === 0 ? (
        <EmptyState
          icon={CalendarRange}
          title="Belum ada periode"
          description={`Periode dibangun dari tanggal proyek, ${formatDay(overview.projectStart)} sampai ${formatDay(overview.projectEnd)}. Semua yang dihitung per waktu — progres, kurva-S, arus kas — bertumpu pada periode ini.`}
          action={
            <PeriodSettings
              projectId={projectId}
              periodType={overview.periodType}
              projectStart={overview.projectStart}
              projectEnd={overview.projectEnd}
              hasPeriods={false}
              canEdit={canEdit}
              variant="default"
              label="Bangun periode sekarang"
            />
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="secondary">{PERIOD_TYPE_LABELS[overview.periodType]}</Badge>
            <span>
              {overview.periods.length} periode · {formatDay(overview.projectStart)} –{' '}
              {formatDay(overview.projectEnd)}
            </span>
            {overview.activeBaseline ? (
              <Badge variant="outline">Baseline: {overview.activeBaseline.name}</Badge>
            ) : (
              <Badge variant="outline">Belum ada baseline</Badge>
            )}
            {!overview.workCalendar.countWeekends ? (
              <Badge variant="outline">Tanpa akhir pekan</Badge>
            ) : null}
            {overview.workCalendar.holidays.length > 0 ? (
              <Badge variant="outline">
                {overview.workCalendar.holidays.length} hari libur
              </Badge>
            ) : null}
          </div>

          <WorkCalendarPanel
            projectId={projectId}
            countWeekends={overview.workCalendar.countWeekends}
            holidays={holidays}
            canEdit={canEdit}
          />

          {overview.incomplete.length > 0 ? (
            <Alert>
              <Info className="size-4" aria-hidden />
              <AlertTitle>
                {overview.incomplete.length} pekerjaan belum tersebar penuh
              </AlertTitle>
              <AlertDescription>
                Baseline hanya dapat dikunci ketika setiap pekerjaan berbobot tersebar tepat 100%
                di seluruh periode. Yang belum: {incompleteCodes.slice(0, 8).join(', ')}
                {incompleteCodes.length > 8 ? `, dan ${incompleteCodes.length - 8} lainnya` : ''}.
              </AlertDescription>
            </Alert>
          ) : null}

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Gantt rencana</h2>
            <GanttChart
              projectId={projectId}
              projectStart={overview.projectStart}
              projectEnd={overview.projectEnd}
              periodType={overview.periodType}
              periods={overview.periods}
              rows={overview.rows}
              canEdit={canEdit}
            />
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Distribusi bobot per periode</h2>
            <p className="text-xs text-muted-foreground">
              Angka dalam persen dari pekerjaan itu sendiri, bukan dari proyek. Satu baris disimpan
              sekaligus agar matriksnya tidak pernah tersimpan dalam keadaan setengah jadi.
            </p>
            <DistributionMatrix
              projectId={projectId}
              periods={overview.periods}
              rows={overview.rows}
              matrix={overview.matrix}
              canEdit={canEdit}
            />
          </section>

          {baselines.length > 0 ? (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold">Baseline</h2>
              <BaselineList
                projectId={projectId}
                baselines={baselines}
                canManage={canManageBaseline}
              />
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
