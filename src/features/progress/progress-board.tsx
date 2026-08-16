'use client';

import {
  Ban,
  CheckCheck,
  ClipboardCheck,
  ListChecks,
  Loader2,
  Send,
  SquarePen,
  Trash2,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { selectClassName } from '@/features/master-data/form-fields';
import { ZERO, toDecimal } from '@/lib/calc/decimal';
import { EMPTY_VALUE, formatPercent } from '@/lib/format';
import { PROGRESS_COLUMN_LABELS } from '@/lib/reports/labels';
import { cn } from '@/lib/utils';
import { type ProgressBoard, type ProgressBoardRow } from '@/services/progress';

import {
  approveAllAction,
  approveProgressAction,
  deleteProgressAction,
  rejectProgressAction,
  submitProgressAction,
} from './actions';
import { ChecklistDialog } from './checklist-dialog';
import { MilestoneDialog } from './milestone-dialog';
import { ProgressDialog } from './progress-dialog';

/**
 * Column totals for the footer row.
 *
 * Only weighted items are counted: an item excluded from the progress weight
 * carries no share of the project, and adding its own percentage in here would
 * push the total past what has actually been earned.
 */
function sumWeighted(rows: readonly ProgressBoardRow[]) {
  const weighted = rows.filter((row) => row.includeInProgressWeight);
  const add = (pick: (row: ProgressBoardRow) => string) =>
    weighted.reduce((acc, row) => acc.plus(toDecimal(pick(row))), ZERO);

  return {
    weight: add((row) => row.weight),
    previous: add((row) => row.weighted.previous),
    current: add((row) => row.weighted.current),
    cumulative: add((row) => row.weighted.cumulative),
    planned: add((row) => row.weighted.planned),
    deviation: add((row) => row.weighted.deviation),
  };
}

const STATUS_LABELS = {
  DRAFT: 'Draf',
  SUBMITTED: 'Diajukan',
  APPROVED: 'Disetujui',
  REJECTED: 'Ditolak',
} as const;

const STATUS_VARIANTS = {
  DRAFT: 'outline',
  SUBMITTED: 'default',
  APPROVED: 'secondary',
  REJECTED: 'destructive',
} as const;

export function ProgressBoardView({
  projectId,
  board,
  canRecord,
}: {
  projectId: string;
  board: ProgressBoard;
  canRecord: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [recording, setRecording] = useState<ProgressBoardRow | null>(null);
  const [staging, setStaging] = useState<ProgressBoardRow | null>(null);
  const [checking, setChecking] = useState<ProgressBoardRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [pending, startTransition] = useTransition();

  const period = board.periods.find((p) => p.id === board.selectedPeriodId) ?? null;

  const selectPeriod = (periodId: string) => {
    const next = new URLSearchParams(params.toString());
    next.set('period', periodId);
    router.push(`/projects/${projectId}/progress?${next.toString()}`);
  };

  const run = (id: string, fn: () => Promise<{ ok: boolean; message?: string; hint?: string }>) => {
    setBusyId(id);
    startTransition(async () => {
      const result = await fn();
      setBusyId(null);
      if (result.ok) router.refresh();
      else toast.error(result.message ?? 'Gagal.', { description: result.hint });
    });
  };

  const pendingHere = board.rows.filter((row) => row.status === 'SUBMITTED');
  const columns = PROGRESS_COLUMN_LABELS[board.periodType];
  const totals = sumWeighted(board.rows);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="period">Periode</Label>
          <select
            id="period"
            className={cn(selectClassName, 'w-64')}
            value={board.selectedPeriodId ?? ''}
            onChange={(e) => selectPeriod(e.target.value)}
          >
            {board.periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        {board.canApprove && pendingHere.length > 0 && board.selectedPeriodId ? (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await approveAllAction(projectId, board.selectedPeriodId!);
                if (!result.ok) {
                  toast.error(result.message, { description: result.hint });
                  return;
                }
                if (result.skipped.length === 0) {
                  toast.success(`${result.approved} catatan disetujui.`);
                } else {
                  // A bulk action that quietly skips half its work is worse
                  // than one that says so.
                  toast.warning(
                    `${result.approved} disetujui, ${result.skipped.length} dilewati.`,
                    { description: result.skipped[0]?.reason },
                  );
                }
                router.refresh();
              })
            }
          >
            <CheckCheck className="size-4" aria-hidden />
            Setujui semua ({pendingHere.length})
          </Button>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">Kode</TableHead>
              <TableHead>Uraian</TableHead>
              <TableHead className="w-24 text-right">Bobot</TableHead>
              <TableHead className="w-28 text-right">{columns.previous}</TableHead>
              <TableHead className="w-28 text-right">{columns.current}</TableHead>
              <TableHead className="w-32 text-right">{columns.cumulative}</TableHead>
              <TableHead className="w-28 text-right">Rencana</TableHead>
              <TableHead className="w-28 text-right">Deviasi</TableHead>
              <TableHead className="w-28">Status</TableHead>
              {board.requireChecklist ? <TableHead className="w-24">Mutu</TableHead> : null}
              <TableHead className="w-64" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {board.rows.map((row) => {
              const busy = pending && busyId === row.workItemId;
              const done = row.remaining === '0';

              /*
               * An item outside the progress weight has no share of the
               * project, so its weighted cells stay blank rather than printing
               * a row of zeros that invites the reader to wonder what went
               * wrong with it.
               */
              const bobot = (value: string) =>
                row.includeInProgressWeight ? formatPercent(value, 2) : EMPTY_VALUE;

              return (
                <TableRow key={row.workItemId}>
                  <TableCell className="font-mono text-xs">{row.code}</TableCell>
                  <TableCell>
                    {row.name}
                    {row.rejectReason ? (
                      <span className="block text-xs text-destructive">
                        Ditolak: {row.rejectReason}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                    {row.includeInProgressWeight ? formatPercent(row.weight, 1) : EMPTY_VALUE}
                  </TableCell>

                  {/*
                    Weighted figures — a share of the whole project, so the
                    column adds up to the progress at the foot of the table.
                    The item's own percentage rides underneath, because that is
                    the number the field user typed and recognises.
                  */}
                  <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                    {bobot(row.weighted.previous)}
                    <span className="block text-[10px]">
                      {formatPercent(row.earnedBefore, 1)} pekerjaan
                    </span>
                  </TableCell>

                  {/*
                    An unapproved entry shows a dash rather than a zero: the
                    work may well be done, but nothing has been earned yet, and
                    the status badge alongside says why.
                  */}
                  <TableCell
                    className={cn(
                      'text-right font-mono tabular-nums',
                      row.status === 'APPROVED' && 'font-medium',
                    )}
                  >
                    {row.status === 'APPROVED' ? bobot(row.weighted.current) : EMPTY_VALUE}
                    {row.status === null ? null : (
                      <span className="block text-[10px] text-muted-foreground">
                        {formatPercent(row.pctThisPeriod, 1)} pekerjaan
                        {row.status === 'APPROVED' ? '' : ' diklaim'}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono font-medium tabular-nums">
                    {bobot(row.weighted.cumulative)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                    {bobot(row.weighted.planned)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      'text-right font-mono tabular-nums',
                      row.includeInProgressWeight &&
                        toDecimal(row.weighted.deviation).isNegative()
                        ? 'text-destructive'
                        : 'text-muted-foreground',
                    )}
                  >
                    {bobot(row.weighted.deviation)}
                  </TableCell>
                  <TableCell>
                    {row.status === null ? (
                      <span className="text-xs text-muted-foreground">belum dicatat</span>
                    ) : (
                      <Badge variant={STATUS_VARIANTS[row.status]} className="text-[10px]">
                        {STATUS_LABELS[row.status]}
                      </Badge>
                    )}
                  </TableCell>

                  {board.requireChecklist ? (
                    <TableCell>
                      {row.checklistVerdict === 'PASS' ? (
                        <Badge variant="secondary" className="text-[10px]">
                          lulus
                        </Badge>
                      ) : row.checklistVerdict === 'FAIL' ? (
                        <Badge variant="destructive" className="text-[10px]">
                          gagal
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  ) : null}

                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {/*
                        A milestone item is never given a percentage box: its
                        figure is derived from the stages, and typing over it
                        would let the two disagree.
                      */}
                      {canRecord && row.status !== 'APPROVED' ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy || (done && row.status === null)}
                          title={
                            done && row.status === null
                              ? 'Pekerjaan ini sudah 100% selesai.'
                              : row.method === 'MILESTONE'
                                ? 'Progres dihitung dari tahapan yang selesai.'
                                : undefined
                          }
                          onClick={() =>
                            row.method === 'MILESTONE' ? setStaging(row) : setRecording(row)
                          }
                        >
                          {row.method === 'MILESTONE' ? (
                            <ListChecks className="size-3.5" aria-hidden />
                          ) : (
                            <SquarePen className="size-3.5" aria-hidden />
                          )}
                          {row.method === 'MILESTONE' ? 'Tahapan' : 'Catat'}
                        </Button>
                      ) : null}

                      {canRecord && board.requireChecklist && board.selectedPeriodId ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => setChecking(row)}
                        >
                          <ClipboardCheck className="size-3.5" aria-hidden />
                          Mutu
                        </Button>
                      ) : null}

                      {canRecord && row.entryId && (row.status === 'DRAFT' || row.status === 'REJECTED') ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            run(row.workItemId, () =>
                              submitProgressAction(projectId, row.entryId!),
                            )
                          }
                        >
                          {busy ? (
                            <Loader2 className="size-3.5 animate-spin" aria-hidden />
                          ) : (
                            <Send className="size-3.5" aria-hidden />
                          )}
                          Ajukan
                        </Button>
                      ) : null}

                      {/*
                        Only while it is still a draft or was sent back. An
                        approved entry stays put — the audit trail has to keep
                        showing what was signed off.
                      */}
                      {canRecord && row.entryId && (row.status === 'DRAFT' || row.status === 'REJECTED') ? (
                        <AlertDialog>
                          <AlertDialogTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="text-destructive hover:text-destructive"
                                disabled={busy}
                                aria-label={`Hapus catatan ${row.code}`}
                              />
                            }
                          >
                            <Trash2 className="size-3.5" aria-hidden />
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Hapus catatan progres {row.code}?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Catatan periode ini dihapus sepenuhnya, dan pekerjaannya kembali
                                seperti belum pernah dicatat pada periode ini.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Batal</AlertDialogCancel>
                              <Button
                                variant="destructive"
                                disabled={pending}
                                onClick={() =>
                                  run(row.workItemId, async () => {
                                    const result = await deleteProgressAction(
                                      projectId,
                                      row.entryId!,
                                    );
                                    if (result.ok) toast.success('Catatan progres dihapus.');
                                    return result;
                                  })
                                }
                              >
                                Ya, hapus
                              </Button>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      ) : null}

                      {board.canApprove && row.entryId && row.status === 'SUBMITTED' ? (
                        <>
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              run(row.workItemId, () =>
                                approveProgressAction(projectId, row.entryId!),
                              )
                            }
                          >
                            Setujui
                          </Button>

                          <AlertDialog>
                            <AlertDialogTrigger
                              render={
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-destructive hover:text-destructive"
                                  disabled={busy}
                                />
                              }
                            >
                              <Ban className="size-3.5" aria-hidden />
                              Tolak
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Tolak progres {row.code}?</AlertDialogTitle>
                                <AlertDialogDescription render={<div />}>
                                  <p>
                                    Catatannya kembali menjadi draf agar dapat diperbaiki, bukan
                                    dihapus.
                                  </p>
                                  <div className="mt-3 space-y-1.5">
                                    <Label htmlFor="reject-reason">Alasan penolakan</Label>
                                    <Input
                                      id="reject-reason"
                                      value={reason}
                                      onChange={(e) => setReason(e.target.value)}
                                      placeholder="Contoh: foto tidak menunjukkan area yang dilaporkan"
                                    />
                                  </div>
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Batal</AlertDialogCancel>
                                <Button
                                  variant="destructive"
                                  disabled={pending || reason.trim() === ''}
                                  onClick={() =>
                                    run(row.workItemId, async () => {
                                      const result = await rejectProgressAction(
                                        projectId,
                                        row.entryId!,
                                        reason,
                                      );
                                      if (result.ok) setReason('');
                                      return result;
                                    })
                                  }
                                >
                                  Ya, tolak
                                </Button>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>

          {/*
            The reason the columns are weighted: they add up. This row is the
            project's progress, assembled from the same cells the reader can
            check line by line.
          */}
          <TableFooter>
            <TableRow>
              <TableCell colSpan={2}>Jumlah bobot proyek</TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {formatPercent(totals.weight, 1)}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {formatPercent(totals.previous, 2)}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {formatPercent(totals.current, 2)}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {formatPercent(totals.cumulative, 2)}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {formatPercent(totals.planned, 2)}
              </TableCell>
              <TableCell
                className={cn(
                  'text-right font-mono tabular-nums',
                  totals.deviation.isNegative() ? 'text-destructive' : undefined,
                )}
              >
                {formatPercent(totals.deviation, 2)}
              </TableCell>
              <TableCell colSpan={board.requireChecklist ? 3 : 2} />
            </TableRow>
          </TableFooter>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        Kolom bobot dihitung terhadap seluruh proyek sehingga dapat dijumlahkan ke bawah, dan hanya
        menghitung progres yang sudah disetujui. Angka kecil di bawahnya adalah porsi pekerjaan itu
        sendiri.{' '}
        {board.planFromBaseline
          ? 'Rencana diambil dari baseline aktif.'
          : 'Proyek ini belum punya baseline aktif, jadi rencana diambil dari distribusi draf yang masih dapat berubah.'}
      </p>

      {recording && period ? (
        <ProgressDialog
          open
          onOpenChange={(open) => setRecording(open ? recording : null)}
          projectId={projectId}
          periodId={period.id}
          periodLabel={period.label}
          row={recording}
        />
      ) : null}

      {staging && period ? (
        <MilestoneDialog
          open
          onOpenChange={(open) => setStaging(open ? staging : null)}
          projectId={projectId}
          periodId={period.id}
          periodLabel={period.label}
          row={staging}
        />
      ) : null}

      {checking && period ? (
        <ChecklistDialog
          open
          onOpenChange={(open) => setChecking(open ? checking : null)}
          projectId={projectId}
          workItemId={checking.workItemId}
          periodId={period.id}
          label={`${checking.code} · ${period.label}`}
          current={checking.checklist}
        />
      ) : null}
    </div>
  );
}
