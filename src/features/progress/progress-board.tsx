'use client';

import {
  Ban,
  CheckCheck,
  CircleSlash,
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
import {
  PROGRESS_ENTRY_STATUS_LABELS,
  PROGRESS_ENTRY_STATUS_VARIANTS,
  isEditableProgressStatus,
} from '@/lib/progress/labels';
import { PROGRESS_COLUMN_LABELS } from '@/lib/reports/labels';
import { cn } from '@/lib/utils';
import { type ProgressBoard, type ProgressBoardRow } from '@/services/progress';

import {
  approveAllAction,
  approveProgressAction,
  cancelProgressAction,
  deleteProgressAction,
  rejectProgressAction,
  submitProgressAction,
} from './actions';
import { ChecklistDialog } from './checklist-dialog';
import { type StoredDocument } from './document-uploader';
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

const STATUS_LABELS = PROGRESS_ENTRY_STATUS_LABELS;
const STATUS_VARIANTS = PROGRESS_ENTRY_STATUS_VARIANTS;

export function ProgressBoardView({
  projectId,
  board,
  canRecord,
  documents = [],
}: {
  projectId: string;
  board: ProgressBoard;
  canRecord: boolean;
  /** Photographs stored against the selected period. */
  documents?: StoredDocument[];
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

      {/*
        One scroll container, not two. `Table` already renders its own
        `w-full overflow-x-auto` wrapper, so the border sits outside it and the
        scrolling happens inside — the earlier arrangement nested a scroller in
        a scroller, and the right-hand action column ended up clipped by the
        outer one instead of reachable by scrolling the inner one.
      */}
      <div className="w-full rounded-lg border">
        <Table className="min-w-max">
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">Kode</TableHead>
              <TableHead className="min-w-56">Uraian</TableHead>
              <TableHead className="w-24 text-right">Bobot</TableHead>
              <TableHead className="w-28 text-right">{columns.previous}</TableHead>
              <TableHead className="w-28 text-right">{columns.current}</TableHead>
              <TableHead className="w-32 text-right">{columns.cumulative}</TableHead>
              <TableHead className="w-28 text-right">Rencana</TableHead>
              <TableHead className="w-28 text-right">Deviasi</TableHead>
              <TableHead className="w-28">Status</TableHead>
              {board.requireChecklist ? <TableHead className="w-24">Mutu</TableHead> : null}
              {/*
                Sized to the buttons it actually holds, rather than to the worst
                case.

                It used to reserve 26rem for the busiest row a draft can
                produce — Perbaiki, Batalkan, Mutu, Ajukan and the delete icon
                together. But most rows carry two buttons, and those were pushed
                to the far right of a column two thirds empty, a hand's width
                away from the Mutu column they belong beside. `w-0` asks for
                nothing; auto table layout still gives the column what its widest
                row needs, and the slack goes to Uraian, which can use it.
              */}
              <TableHead className="w-0" />
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
                    {/*
                      `w-max` rather than a plain flex row: flex children may
                      shrink below their own content, and the buttons were
                      losing their labels a few pixels at a time before anything
                      looked wide enough to scroll.

                      Aligned left, not right. The column is as wide as the
                      busiest row in the table, so right-aligning left every
                      quieter row's buttons stranded at the far edge — a hand's
                      width of blank table between Mutu and Catat, which is how
                      it was reported. Starting them all at the same left edge
                      keeps them beside the figures they act on.
                    */}
                    <div className="flex w-max items-center gap-1.5 whitespace-nowrap">
                      {/*
                        A milestone item is never given a percentage box: its
                        figure is derived from the stages, and typing over it
                        would let the two disagree.
                      */}
                      {/*
                        Mirrors the service rule rather than "not approved":
                        a submitted entry is on someone's desk, and editing the
                        figure under a pending decision means the approver signs
                        off something they never read. Withdraw it first.
                      */}
                      {canRecord && isEditableProgressStatus(row.status) ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy || (done && row.status === null)}
                          title={
                            done && row.status === null
                              ? 'Pekerjaan ini sudah 100% selesai.'
                              : row.method === 'MILESTONE'
                                ? 'Progres dihitung dari tahapan yang selesai.'
                                : row.status === 'CANCELLED'
                                  ? 'Catatan dibatalkan; angkanya dapat diperbaiki di sini.'
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
                          {row.method === 'MILESTONE'
                            ? 'Tahapan'
                            : row.status === null
                              ? 'Catat'
                              : 'Perbaiki'}
                        </Button>
                      ) : null}

                      {/*
                        Withdrawing is the way back from a submitted entry, and
                        the way to retract a draft without deleting the trace
                        that it was once claimed.
                      */}
                      {canRecord &&
                      row.entryId &&
                      (row.status === 'DRAFT' ||
                        row.status === 'SUBMITTED' ||
                        row.status === 'REJECTED') ? (
                        <AlertDialog>
                          <AlertDialogTrigger
                            render={<Button variant="ghost" size="sm" disabled={busy} />}
                          >
                            <CircleSlash className="size-3.5" aria-hidden />
                            Batalkan
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Batalkan catatan {row.code}?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Catatannya tetap tersimpan sebagai dibatalkan, tidak menghitung apa
                                pun pada kurva realisasi, dan angkanya dapat diperbaiki kembali
                                setelahnya.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Tidak jadi</AlertDialogCancel>
                              <Button
                                variant="destructive"
                                disabled={pending}
                                onClick={() =>
                                  run(row.workItemId, async () => {
                                    const result = await cancelProgressAction(
                                      projectId,
                                      row.entryId!,
                                    );
                                    if (result.ok) toast.success('Catatan dibatalkan.');
                                    return result;
                                  })
                                }
                              >
                                Ya, batalkan
                              </Button>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
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

                      {/*
                        Approved rows keep the reject control. Sending one back
                        moves the realised curve down again, which is the point:
                        the alternative is a fictional entry in a later period
                        to cancel out an earlier one, leaving both wrong.
                      */}
                      {board.canApprove &&
                      row.entryId &&
                      (row.status === 'SUBMITTED' || row.status === 'APPROVED') ? (
                        <>
                          {row.status === 'SUBMITTED' ? (
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
                          ) : null}

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
                                    Catatannya kembali dapat diperbaiki dan diajukan ulang, bukan
                                    dihapus.
                                    {row.status === 'APPROVED'
                                      ? ' Karena progres ini sudah disetujui, menolaknya juga menurunkan kembali realisasi kumulatif dan kurva-S. Laporan yang sudah terbit tetap membawa angka lamanya.'
                                      : ''}
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
          documents={documents.filter((doc) => doc.workItemId === checking.workItemId)}
        />
      ) : null}
    </div>
  );
}
