'use client';

import { Loader2, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { selectClassName } from '@/features/master-data/form-fields';
import { toDecimal } from '@/lib/calc/decimal';
import { formatCurrency, formatQuantity } from '@/lib/format';

import { createRevisionAction } from './actions';

export type RevisionCandidate = {
  workItemId: string;
  code: string;
  name: string;
  unitCode: string;
  volume: string;
  /** Contract value of one unit, so the dialog can price the change live. */
  unitValue: string;
};

type DraftLine = { workItemId: string; volumeAfter: string; note: string };

/**
 * Drafts a change order.
 *
 * The value of the change is shown while it is typed, per line and in total.
 * A revision is agreed on its money, and asking the user to save first and
 * find out afterwards is how an addendum gets signed for the wrong figure.
 */
export function RevisionDialog({
  open,
  onOpenChange,
  projectId,
  candidates,
  defaultEffectiveDate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  candidates: RevisionCandidate[];
  defaultEffectiveDate: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [reason, setReason] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(defaultEffectiveDate);
  /*
   * Kept as text, not a number. An empty box is a legitimate intermediate
   * state while typing, and a numeric state would turn it into 0 or NaN under
   * the user's cursor; the schema coerces it once, on submit.
   */
  const [scheduleImpactDays, setScheduleImpactDays] = useState('0');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [formError, setFormError] = useState<{ message: string; hint?: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const byId = new Map(candidates.map((c) => [c.workItemId, c]));
  const used = new Set(lines.map((line) => line.workItemId));
  const available = candidates.filter((c) => !used.has(c.workItemId));

  const deltaOf = (line: DraftLine): { volume: string; value: string } => {
    const item = byId.get(line.workItemId);
    if (!item) return { volume: '0', value: '0' };
    const after = line.volumeAfter.trim() === '' ? toDecimal(0) : toDecimal(line.volumeAfter);
    const delta = after.minus(toDecimal(item.volume));
    return { volume: delta.toString(), value: delta.times(toDecimal(item.unitValue)).toFixed(2) };
  };

  const netValue = lines.reduce(
    (acc, line) => acc.plus(toDecimal(deltaOf(line).value)),
    toDecimal(0),
  );

  const addLine = () => {
    const next = available[0];
    if (!next) return;
    setLines((current) => [
      ...current,
      { workItemId: next.workItemId, volumeAfter: next.volume, note: '' },
    ]);
  };

  const patchLine = (index: number, patch: Partial<DraftLine>) => {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  };

  const submit = () => {
    setFormError(null);

    startTransition(async () => {
      const result = await createRevisionAction(projectId, {
        title,
        reason,
        effectiveDate,
        scheduleImpactDays,
        lines: lines.map((line) => ({
          workItemId: line.workItemId,
          volumeAfter: line.volumeAfter,
          note: line.note,
        })),
      });

      if (result.ok) {
        toast.success('Revisi CCO dibuat sebagai draf.');
        onOpenChange(false);
        setTitle('');
        setReason('');
        setLines([]);
        router.refresh();
        return;
      }

      setFormError(
        result.hint === undefined
          ? { message: result.message }
          : { message: result.message, hint: result.hint },
      );
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Revisi CCO baru</DialogTitle>
          <DialogDescription>
            Pilih pekerjaan yang volumenya berubah, lalu isi volume setelah revisi. Menaikkan
            volume berarti pekerjaan tambah; menurunkannya sampai nol berarti pekerjaan tidak jadi
            dikerjakan. Nomornya diberikan otomatis dan revisinya tersimpan sebagai draf sampai
            disetujui.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {formError ? (
            <Alert variant="destructive">
              <AlertTitle>{formError.message}</AlertTitle>
              {formError.hint ? <AlertDescription>{formError.hint}</AlertDescription> : null}
            </Alert>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
            <div className="space-y-1.5">
              <Label htmlFor="cco-title">Judul revisi</Label>
              <Input
                id="cco-title"
                value={title}
                placeholder="Contoh: Penyesuaian volume galian dan struktur"
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cco-date">Tanggal berlaku</Label>
              <Input
                id="cco-date"
                type="date"
                value={effectiveDate}
                onChange={(event) => setEffectiveDate(event.target.value)}
              />
            </div>
          </div>

          {/*
            Time, beside the money it comes with. Work added to a contract
            usually adds days to it, and the extension is the part a delay
            claim rests on — recorded when the addendum is drafted, not
            remembered afterwards.
          */}
          <div className="space-y-1.5">
            <Label htmlFor="cco-days">Perpanjangan waktu (hari)</Label>
            <Input
              id="cco-days"
              inputMode="numeric"
              value={scheduleImpactDays}
              onChange={(event) => setScheduleImpactDays(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Diterapkan ke tanggal selesai proyek saat revisi disetujui. Isi 0 bila tidak menambah
              waktu, atau angka negatif bila pekerjaannya justru dipercepat.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cco-reason">Dasar / alasan</Label>
            <Input
              id="cco-reason"
              value={reason}
              placeholder="Contoh: Berita acara lapangan 12 Mei, kondisi tanah berbeda dari rencana"
              onChange={(event) => setReason(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Pekerjaan yang berubah</h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={available.length === 0}
                onClick={addLine}
              >
                <Plus className="size-4" aria-hidden />
                Tambah baris
              </Button>
            </div>

            {lines.length === 0 ? (
              <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                Belum ada baris. Tambahkan pekerjaan yang volumenya berubah.
              </p>
            ) : (
              <ul className="space-y-2">
                {lines.map((line, index) => {
                  const item = byId.get(line.workItemId);
                  const delta = deltaOf(line);
                  const negative = toDecimal(delta.value).isNegative();

                  return (
                    <li key={index} className="rounded-md border p-3">
                      <div className="grid gap-3 sm:grid-cols-[1fr_9rem_9rem_2rem]">
                        <div className="space-y-1.5">
                          <Label htmlFor={`cco-item-${index}`}>Pekerjaan</Label>
                          <select
                            id={`cco-item-${index}`}
                            className={selectClassName}
                            value={line.workItemId}
                            onChange={(event) => {
                              const next = byId.get(event.target.value);
                              patchLine(index, {
                                workItemId: event.target.value,
                                volumeAfter: next?.volume ?? '0',
                              });
                            }}
                          >
                            {[item, ...available]
                              .filter((c): c is RevisionCandidate => c !== undefined)
                              .map((c) => (
                                <option key={c.workItemId} value={c.workItemId}>
                                  {c.code} — {c.name}
                                </option>
                              ))}
                          </select>
                        </div>

                        <div className="space-y-1.5">
                          <Label>Volume awal</Label>
                          <p className="flex h-9 items-center justify-end rounded-md border bg-muted/40 px-3 font-mono text-sm tabular-nums">
                            {formatQuantity(item?.volume ?? '0')}
                          </p>
                        </div>

                        <div className="space-y-1.5">
                          <Label htmlFor={`cco-volume-${index}`}>
                            Volume akhir {item ? `(${item.unitCode})` : ''}
                          </Label>
                          <Input
                            id={`cco-volume-${index}`}
                            inputMode="decimal"
                            className="text-right font-mono tabular-nums"
                            value={line.volumeAfter}
                            onChange={(event) =>
                              patchLine(index, { volumeAfter: event.target.value })
                            }
                          />
                        </div>

                        <div className="flex items-end">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Hapus baris ${item?.code ?? index + 1}`}
                            onClick={() =>
                              setLines((current) => current.filter((_, i) => i !== index))
                            }
                          >
                            <Trash2 className="size-4" aria-hidden />
                          </Button>
                        </div>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                        <Input
                          value={line.note}
                          placeholder="Catatan baris (opsional)"
                          className="h-8 max-w-md"
                          onChange={(event) => patchLine(index, { note: event.target.value })}
                        />
                        <p className="text-xs">
                          <span className="text-muted-foreground">Selisih </span>
                          <span className="font-mono tabular-nums">{delta.volume}</span>
                          <span className="text-muted-foreground"> {item?.unitCode} · </span>
                          <span
                            className={`font-mono font-medium tabular-nums ${
                              negative ? 'text-destructive' : ''
                            }`}
                          >
                            {formatCurrency(delta.value)}
                          </span>
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {lines.length > 0 ? (
              <p className="text-right text-sm">
                <span className="text-muted-foreground">Nilai bersih revisi: </span>
                <span
                  className={`font-mono font-semibold tabular-nums ${
                    netValue.isNegative() ? 'text-destructive' : ''
                  }`}
                >
                  {formatCurrency(netValue.toFixed(2))}
                </span>
              </p>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button
            type="button"
            disabled={pending || lines.length === 0 || title.trim() === ''}
            onClick={submit}
          >
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {pending ? 'Menyimpan…' : 'Simpan sebagai draf'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
