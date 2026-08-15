'use client';

import { CalendarRange, Loader2 } from 'lucide-react';
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
import { Label } from '@/components/ui/label';
import { selectClassName } from '@/features/master-data/form-fields';
import { formatDay } from '@/lib/format';
import { PERIOD_TYPE_LABELS } from '@/lib/validation/schedule';
import { type PeriodPlanPreview } from '@/services/schedule';

import { previewPeriodsAction, regeneratePeriodsAction } from './actions';

/**
 * Builds or rebuilds the period calendar.
 *
 * The impact is shown before anything is written: periods carry the plan, and
 * a shortened project would otherwise discard planned cells with no warning
 * (charter section 6.5).
 */
export function PeriodSettings({
  projectId,
  periodType,
  projectStart,
  projectEnd,
  hasPeriods,
  canEdit,
  label,
  variant,
}: {
  projectId: string;
  periodType: 'DAY' | 'WEEK' | 'MONTH';
  projectStart: string;
  projectEnd: string;
  hasPeriods: boolean;
  canEdit: boolean;
  label?: string;
  variant?: React.ComponentProps<typeof Button>['variant'];
}) {
  const [open, setOpen] = useState(false);

  if (!canEdit) return null;

  return (
    <>
      <Button variant={variant ?? 'outline'} onClick={() => setOpen(true)}>
        <CalendarRange className="size-4" aria-hidden />
        {label ?? (hasPeriods ? 'Atur periode' : 'Bangun periode')}
      </Button>
      {open ? (
        <PeriodDialog
          open
          onOpenChange={setOpen}
          projectId={projectId}
          periodType={periodType}
          projectStart={projectStart}
          projectEnd={projectEnd}
        />
      ) : null}
    </>
  );
}

function PeriodDialog({
  open,
  onOpenChange,
  projectId,
  periodType,
  projectStart,
  projectEnd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  periodType: 'DAY' | 'WEEK' | 'MONTH';
  projectStart: string;
  projectEnd: string;
}) {
  const router = useRouter();
  const [chosen, setChosen] = useState<'DAY' | 'WEEK' | 'MONTH'>(periodType);
  const [preview, setPreview] = useState<PeriodPlanPreview | null>(null);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [loading, startLoading] = useTransition();
  const [saving, startSaving] = useTransition();

  // Re-previewed on every change of unit: the counts are the whole point of
  // choosing one.
  useEffect(() => {
    startLoading(async () => {
      const result = await previewPeriodsAction(projectId, chosen);
      if (result.ok) {
        setPreview(result.preview);
        setError(null);
      } else {
        setPreview(null);
        setError(result.hint === undefined ? { message: result.message } : result);
      }
    });
  }, [projectId, chosen]);

  const generated = preview?.generated ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Periode proyek</DialogTitle>
          <DialogDescription>
            Dibangun dari tanggal proyek: {formatDay(projectStart)} – {formatDay(projectEnd)}.
            Ubah tanggalnya di Info Proyek bila rentangnya keliru.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>{error.message}</AlertTitle>
              {error.hint ? <AlertDescription>{error.hint}</AlertDescription> : null}
            </Alert>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="periodType">Satuan periode</Label>
            <select
              id="periodType"
              className={selectClassName}
              value={chosen}
              onChange={(e) => setChosen(e.target.value as 'DAY' | 'WEEK' | 'MONTH')}
            >
              {Object.entries(PERIOD_TYPE_LABELS).map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Mingguan dan bulanan mengikuti kalender, sehingga periode pertama dan terakhir
              biasanya lebih pendek.
            </p>
          </div>

          {loading ? (
            <p className="text-sm text-muted-foreground">Menghitung…</p>
          ) : preview ? (
            <div className="space-y-3 rounded-lg border bg-muted/30 p-3 text-sm">
              <p>
                <span className="font-medium">{generated.length} periode</span> akan terbentuk —{' '}
                {preview.keptCount} dipertahankan, {preview.addedCount} baru
                {preview.removed.length > 0 ? `, ${preview.removed.length} dihapus` : ''}.
              </p>

              {generated.length > 0 ? (
                <p className="text-xs text-muted-foreground">
                  {generated[0]?.label} ({formatDay(generated[0]?.startDate)} –{' '}
                  {formatDay(generated[0]?.endDate)}) … {generated.at(-1)?.label} (
                  {formatDay(generated.at(-1)?.startDate)} – {formatDay(generated.at(-1)?.endDate)})
                </p>
              ) : null}

              {preview.wouldDiscardPlan ? (
                <Alert variant="destructive">
                  <AlertTitle>Rencana pada periode terakhir akan terhapus</AlertTitle>
                  <AlertDescription>
                    {preview.removed.reduce((acc, p) => acc + p.distributionCount, 0)} sel rencana
                    masih mengisi periode yang akan hilang. Kosongkan dulu distribusinya, atau
                    perpanjang tanggal selesai proyek.
                  </AlertDescription>
                </Alert>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button
            disabled={saving || loading || preview === null || preview.wouldDiscardPlan}
            onClick={() =>
              startSaving(async () => {
                const result = await regeneratePeriodsAction(projectId, chosen);
                if (result.ok) {
                  toast.success('Periode diperbarui.', {
                    description: `${result.kept} dipertahankan, ${result.added} baru, ${result.removed} dihapus.`,
                  });
                  onOpenChange(false);
                  router.refresh();
                } else {
                  setError(result.hint === undefined ? { message: result.message } : result);
                }
              })
            }
          >
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {saving ? 'Menyimpan…' : 'Terapkan'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
