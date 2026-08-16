'use client';

import { Check, Loader2, Lock, Plus, Printer, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
import { Button, ButtonLink } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EMPTY_VALUE, formatCurrency, formatDay, formatPercent } from '@/lib/format';
import type { RevisionRow } from '@/services/contract-revisions';

import {
  approveRevisionAction,
  cancelRevisionAction,
  deleteRevisionAction,
  freezeBaselineAction,
} from './actions';
import { RevisionDialog, type RevisionCandidate } from './revision-dialog';

const STATUS_VARIANTS = {
  DRAFT: 'outline',
  APPROVED: 'secondary',
  CANCELLED: 'destructive',
} as const;

const STATUS_LABELS = {
  DRAFT: 'Draf',
  APPROVED: 'Disetujui',
  CANCELLED: 'Dibatalkan',
} as const;

/**
 * The change orders of one project.
 *
 * Approval is deliberately a two-step act with its consequences spelled out:
 * it rewrites volumes on the work breakdown and moves the project's contract
 * value, and everything derived from those — weights, the S-curve, earned
 * value — moves with it. That is not something to discover after clicking.
 */
export function RevisionBoard({
  projectId,
  revisions,
  candidates,
  baseline,
  defaultEffectiveDate,
  canDraft,
  canApprove,
}: {
  projectId: string;
  revisions: RevisionRow[];
  candidates: RevisionCandidate[];
  baseline: { frozenAt: string; itemCount: number; contractValue: string } | null;
  defaultEffectiveDate: string;
  canDraft: boolean;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [drafting, setDrafting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (id: string, fn: () => Promise<{ ok: boolean; message?: string; hint?: string }>) => {
    setBusyId(id);
    startTransition(async () => {
      const result = await fn();
      setBusyId(null);
      if (result.ok) router.refresh();
      else toast.error(result.message ?? 'Gagal.', { description: result.hint });
    });
  };

  return (
    <div className="space-y-4">
      <section className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-4">
        <div>
          <h2 className="text-sm font-semibold">Baseline 0 — lingkup awal</h2>
          {baseline ? (
            <p className="text-xs text-muted-foreground">
              Dikunci {formatDay(baseline.frozenAt.slice(0, 10))} · {baseline.itemCount} pekerjaan ·
              nilai kontrak {formatCurrency(baseline.contractValue)}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Belum dikunci. Baseline 0 adalah salinan beku lingkup awal — volume, nilai, dan bobot
              sebelum revisi mana pun — dan menjadi pembanding pada setiap laporan CCO. Dikunci
              otomatis saat CCO pertama disetujui bila belum dilakukan di sini.
            </p>
          )}
        </div>

        {baseline === null && canApprove ? (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              run('baseline', async () => {
                const result = await freezeBaselineAction(projectId, null);
                if (result.ok) toast.success('Baseline 0 dikunci.');
                return result;
              })
            }
          >
            {pending && busyId === 'baseline' ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Lock className="size-4" aria-hidden />
            )}
            Kunci Baseline 0
          </Button>
        ) : null}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Revisi CCO</h2>
        <div className="flex items-center gap-2">
          {/*
            `ButtonLink`, not a `Button` rendering a `Link`. Base UI's button
            expects a native <button> and warns when handed an anchor, because
            the two are not interchangeable: one submits forms and answers the
            space bar, the other navigates and offers "open in new tab". This
            is navigation, so it is an anchor that looks like a button.
          */}
          <ButtonLink href={`/projects/${projectId}/cco/print`} variant="outline">
            <Printer className="size-4" aria-hidden />
            Cetak laporan CCO
          </ButtonLink>
          {canDraft ? (
            <Button disabled={candidates.length === 0} onClick={() => setDrafting(true)}>
              <Plus className="size-4" aria-hidden />
              Revisi baru
            </Button>
          ) : null}
        </div>
      </div>

      {revisions.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
          Belum ada revisi CCO.
        </p>
      ) : (
        <div className="w-full rounded-lg border">
          <Table className="min-w-max">
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Nomor</TableHead>
                <TableHead className="min-w-64">Judul</TableHead>
                <TableHead className="w-28">Berlaku</TableHead>
                <TableHead className="w-20 text-right">Baris</TableHead>
                <TableHead className="w-40 text-right">Nilai kontrak</TableHead>
                <TableHead className="w-36 text-right">Selisih</TableHead>
                <TableHead className="w-28">Status</TableHead>
                <TableHead className="w-64" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {revisions.map((revision) => {
                const busy = pending && busyId === revision.id;
                const delta =
                  revision.contractValueBefore === null || revision.contractValueAfter === null
                    ? null
                    : Number(revision.contractValueAfter) - Number(revision.contractValueBefore);

                return (
                  <TableRow key={revision.id}>
                    <TableCell className="font-mono text-xs">
                      <Link
                        href={`/projects/${projectId}/cco/print?revision=${revision.id}`}
                        className="hover:underline"
                      >
                        {revision.code}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {revision.title}
                      {revision.reason ? (
                        <span className="block text-xs text-muted-foreground">
                          {revision.reason}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDay(revision.effectiveDate)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {revision.lineCount}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {revision.contractValueAfter === null
                        ? EMPTY_VALUE
                        : formatCurrency(revision.contractValueAfter)}
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono tabular-nums ${
                        delta !== null && delta < 0 ? 'text-destructive' : ''
                      }`}
                    >
                      {delta === null ? EMPTY_VALUE : formatCurrency(delta.toFixed(2))}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANTS[revision.status]} className="text-[10px]">
                        {STATUS_LABELS[revision.status]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="ml-auto flex w-max items-center gap-1.5 whitespace-nowrap">
                        {canApprove && revision.status === 'DRAFT' ? (
                          <AlertDialog>
                            <AlertDialogTrigger render={<Button size="sm" disabled={busy} />}>
                              <Check className="size-3.5" aria-hidden />
                              Setujui
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Setujui {revision.code}?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Volume pekerjaan pada revisi ini akan ditulis ke daftar
                                  pekerjaan, dan nilai kontrak proyek disesuaikan menjadi nilai
                                  addendum. Bobot seluruh pekerjaan, kurva-S rencana dan realisasi,
                                  serta kebutuhan modal dan material ikut terhitung ulang karena
                                  semuanya diturunkan dari volume itu. Revisi yang sudah disetujui
                                  tidak dapat dihapus — perubahannya dikembalikan lewat revisi
                                  baru.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Batal</AlertDialogCancel>
                                <Button
                                  disabled={pending}
                                  onClick={() =>
                                    run(revision.id, async () => {
                                      const result = await approveRevisionAction(
                                        projectId,
                                        revision.id,
                                      );
                                      if (result.ok) {
                                        toast.success(`${revision.code} disetujui.`);
                                      }
                                      return result;
                                    })
                                  }
                                >
                                  Ya, setujui
                                </Button>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        ) : null}

                        {canApprove && revision.status === 'DRAFT' ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              run(revision.id, async () => {
                                const result = await cancelRevisionAction(projectId, revision.id);
                                if (result.ok) toast.success(`${revision.code} dibatalkan.`);
                                return result;
                              })
                            }
                          >
                            <X className="size-3.5" aria-hidden />
                            Batalkan
                          </Button>
                        ) : null}

                        {canDraft && revision.status !== 'APPROVED' ? (
                          <AlertDialog>
                            <AlertDialogTrigger
                              render={
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  className="text-destructive hover:text-destructive"
                                  disabled={busy}
                                  aria-label={`Hapus ${revision.code}`}
                                />
                              }
                            >
                              <Trash2 className="size-3.5" aria-hidden />
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Hapus {revision.code}?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Draf ini dihapus sepenuhnya. Nomor CCO berikutnya tetap melanjutkan
                                  urutan, sehingga penomoran pada berkas kontrak tidak bergeser.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Batal</AlertDialogCancel>
                                <Button
                                  variant="destructive"
                                  disabled={pending}
                                  onClick={() =>
                                    run(revision.id, async () => {
                                      const result = await deleteRevisionAction(
                                        projectId,
                                        revision.id,
                                      );
                                      if (result.ok) toast.success('Draf revisi dihapus.');
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
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Nilai kontrak proyek mengikuti addendum terakhir yang disetujui. Bobot, kurva-S, nilai
        perolehan (EVA), kebutuhan modal, dan kebutuhan material tidak disimpan sebagai angka —
        semuanya diturunkan dari volume pekerjaan, sehingga ikut menyesuaikan begitu revisi
        disetujui, tanpa langkah hitung ulang terpisah yang bisa terlupa dijalankan.
        {revisions.some((r) => r.status === 'APPROVED')
          ? ' Laporan yang sudah terbit tetap membawa angka lamanya.'
          : ''}
      </p>

      {drafting ? (
        <RevisionDialog
          open
          onOpenChange={setDrafting}
          projectId={projectId}
          candidates={candidates}
          defaultEffectiveDate={defaultEffectiveDate}
        />
      ) : null}
    </div>
  );
}

export function RevisionWeightNote({ percent }: { percent: string | null }) {
  return (
    <span className="font-mono tabular-nums">
      {percent === null ? EMPTY_VALUE : formatPercent(percent)}
    </span>
  );
}
