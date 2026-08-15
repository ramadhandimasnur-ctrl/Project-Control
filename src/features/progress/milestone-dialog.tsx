'use client';

import { Loader2, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
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
import { toDecimal } from '@/lib/calc/decimal';
import { formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';
import { type ProgressBoardRow } from '@/services/progress';

import { listMilestonesAction, saveMilestoneProgressAction } from './actions';

type Draft = {
  id: string | null;
  name: string;
  /** Typed as whole percent; converted at the boundary. */
  weightInput: string;
  completed: boolean;
  completedAt: string | null;
};

/**
 * Stages of a work item measured by milestone.
 *
 * The stages are defined and ticked in one place because that is how they are
 * used: someone standing on site marks the pour finished, and the same visit is
 * when they notice a stage was never listed.
 *
 * The period's progress is the increment — everything now finished minus what
 * earlier periods already had approved — so a stage ticked in March is credited
 * to March and not to every period after it.
 */
export function MilestoneDialog({
  open,
  onOpenChange,
  projectId,
  periodId,
  periodLabel,
  row,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  periodId: string;
  periodLabel: string;
  row: ProgressBoardRow;
}) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    let alive = true;
    void listMilestonesAction(projectId, row.workItemId).then((result) => {
      if (!alive) return;
      if (result.ok) {
        setDrafts(
          result.milestones.map((milestone) => ({
            id: milestone.id,
            name: milestone.name,
            weightInput: toDecimal(milestone.weight).times(100).toDecimalPlaces(4).toString(),
            completed: milestone.completedAt !== null,
            completedAt: milestone.completedAt,
          })),
        );
      } else {
        setError({ message: result.message });
      }
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [projectId, row.workItemId]);

  const totalWeight = drafts.reduce((acc, draft) => acc + (Number(draft.weightInput) || 0), 0);
  const completedWeight = drafts
    .filter((draft) => draft.completed)
    .reduce((acc, draft) => acc + (Number(draft.weightInput) || 0), 0);

  const completedBefore = Number(row.completedBefore) * 100;
  const increment = Math.max(completedWeight - completedBefore, 0);

  const setDraft = (index: number, patch: Partial<Draft>) => {
    setDrafts((current) =>
      current.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)),
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Tahapan {row.code} — {periodLabel}
          </DialogTitle>
          <DialogDescription>
            Progres pekerjaan ini dihitung dari tahapan yang selesai. Bobot dalam persen terhadap
            pekerjaan itu sendiri.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>{error.message}</AlertTitle>
              {error.hint ? <AlertDescription>{error.hint}</AlertDescription> : null}
            </Alert>
          ) : null}

          {loading ? (
            <p className="text-sm text-muted-foreground">Memuat tahapan…</p>
          ) : (
            <>
              {drafts.length === 0 ? (
                <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                  Belum ada tahapan. Tambahkan minimal satu agar progresnya dapat dihitung.
                </p>
              ) : (
                <ul className="space-y-2">
                  {drafts.map((draft, index) => (
                    <li
                      key={draft.id ?? `new-${index}`}
                      className="grid items-center gap-2 rounded-md border p-2 sm:grid-cols-[auto_1fr_5rem_2rem]"
                    >
                      <input
                        type="checkbox"
                        aria-label={`Tandai ${draft.name || 'tahapan'} selesai`}
                        checked={draft.completed}
                        onChange={(e) =>
                          setDraft(index, {
                            completed: e.target.checked,
                            completedAt: e.target.checked ? (draft.completedAt ?? today) : null,
                          })
                        }
                        className="size-4 accent-[var(--primary)]"
                      />
                      <Input
                        aria-label="Nama tahapan"
                        value={draft.name}
                        onChange={(e) => setDraft(index, { name: e.target.value })}
                        placeholder="Pembesian"
                        className="h-8"
                      />
                      <Input
                        aria-label="Bobot tahapan (%)"
                        inputMode="decimal"
                        value={draft.weightInput}
                        onChange={(e) => setDraft(index, { weightInput: e.target.value })}
                        placeholder="%"
                        className="h-8 text-right font-mono"
                      />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Hapus tahapan"
                        onClick={() => setDrafts((c) => c.filter((_, i) => i !== index))}
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}

              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setDrafts((c) => [
                    ...c,
                    { id: null, name: '', weightInput: '', completed: false, completedAt: null },
                  ])
                }
              >
                <Plus className="size-4" aria-hidden />
                Tambah tahapan
              </Button>

              <dl className="space-y-1 rounded-lg border bg-muted/30 p-3 text-sm">
                <Row
                  label="Jumlah bobot tahapan"
                  value={`${Number(totalWeight.toFixed(4))}%`}
                  tone={totalWeight > 100 ? 'text-destructive' : undefined}
                />
                <Row label="Selesai menurut tahapan" value={`${Number(completedWeight.toFixed(4))}%`} />
                <Row label="Sudah disetujui periode lain" value={formatPercent(row.completedBefore, 2)} />
                <div className="flex justify-between border-t pt-1 font-medium">
                  <dt>Tercatat pada {periodLabel}</dt>
                  <dd className="font-mono tabular-nums">{Number(increment.toFixed(4))}%</dd>
                </div>
              </dl>

              {totalWeight > 100 ? (
                <Alert variant="destructive">
                  <AlertTitle>Jumlah bobot melebihi 100%</AlertTitle>
                  <AlertDescription>
                    Sebuah pekerjaan tidak dapat lebih dari selesai. Kurangi salah satu bobotnya.
                  </AlertDescription>
                </Alert>
              ) : totalWeight > 0 && totalWeight < 100 ? (
                <p className="text-xs text-muted-foreground">
                  Bobot tahapan baru mencakup {Number(totalWeight.toFixed(4))}% pekerjaan. Selama
                  belum genap 100%, pekerjaan ini tidak akan pernah terbaca selesai penuh.
                </p>
              ) : null}
            </>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button
            disabled={pending || loading || totalWeight > 100}
            onClick={() =>
              startTransition(async () => {
                const result = await saveMilestoneProgressAction(
                  projectId,
                  row.workItemId,
                  periodId,
                  {
                    milestones: drafts.map((draft, index) => ({
                      id: draft.id,
                      name: draft.name,
                      weight: String((Number(draft.weightInput) || 0) / 100),
                      sortOrder: index,
                      completedAt: draft.completed ? (draft.completedAt ?? today) : null,
                    })),
                    entryDate: today,
                    note: null,
                  },
                );

                if (result.ok) {
                  toast.success('Tahapan tersimpan.', {
                    description: `Tercatat ${formatPercent(result.pctThisPeriod, 2)} pada ${periodLabel}.`,
                  });
                  onOpenChange(false);
                  router.refresh();
                } else {
                  setError(
                    result.hint === undefined
                      ? { message: result.message }
                      : { message: result.message, hint: result.hint },
                  );
                }
              })
            }
          >
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Simpan tahapan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn('font-mono tabular-nums', tone)}>{value}</dd>
    </div>
  );
}
