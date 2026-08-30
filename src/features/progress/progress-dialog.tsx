'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
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
import { TextAreaField, TextField } from '@/features/master-data/form-fields';
import { toDecimal } from '@/lib/calc/decimal';
import { formatPercent, formatQuantity } from '@/lib/format';
import {
  progressEntryFormSchema,
  type ProgressEntryFormInput,
  type ProgressEntryFormValues,
} from '@/lib/validation/progress';
import { type ProgressBoardRow } from '@/services/progress';

import { saveProgressAction } from './actions';

/**
 * Records what a work item achieved in one period.
 *
 * Only the field the item's method calls for is asked. A VOLUME item is
 * reported in its own unit — cubic metres of excavation, not an abstract
 * percentage — because that is the number the site actually measures.
 */
export function ProgressDialog({
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
  const [formError, setFormError] = useState<{ message: string; hint?: string } | null>(null);

  const byVolume = row.method === 'VOLUME';

  const form = useForm<ProgressEntryFormInput, unknown, ProgressEntryFormValues>({
    resolver: zodResolver(progressEntryFormSchema),
    defaultValues: {
      method: row.method,
      qtyThisPeriod: byVolume && row.qtyThisPeriod !== '0' ? row.qtyThisPeriod : '',
      pctInput:
        !byVolume && row.pctThisPeriod !== '0'
          ? toDecimal(row.pctThisPeriod).times(100).toNumber()
          : '',
      entryDate: new Date().toISOString().slice(0, 10),
      location: row.location ?? '',
      note: row.note ?? '',
    },
    mode: 'onBlur',
  });

  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = form;

  const messageOf = (field: keyof ProgressEntryFormInput): string | undefined => {
    const entry = errors[field];
    return typeof entry?.message === 'string' ? entry.message : undefined;
  };

  // Shown live so the share of the work item is never a surprise after saving.
  const preview = (() => {
    try {
      if (byVolume) {
        const qty = toDecimal(String(watch('qtyThisPeriod') ?? '0'));
        const volume = toDecimal(row.volume);
        if (volume.isZero()) return null;
        return qty.dividedBy(volume);
      }
      const pct = Number(watch('pctInput') ?? 0);
      return Number.isFinite(pct) ? toDecimal(pct).dividedBy(100) : null;
    } catch {
      return null;
    }
  })();

  const remaining = toDecimal(row.remaining);
  const overshoots = preview !== null && preview.greaterThan(remaining);

  const onValid = async (values: ProgressEntryFormValues) => {
    setFormError(null);
    const result = await saveProgressAction(projectId, row.workItemId, periodId, values);

    if (result.ok) {
      toast.success('Progres tersimpan sebagai draf.', {
        description: 'Ajukan agar dapat ditinjau dan disetujui.',
      });
      onOpenChange(false);
      router.refresh();
      return;
    }

    if (result.fieldErrors) {
      for (const [field, message] of Object.entries(result.fieldErrors)) {
        setError(field as keyof ProgressEntryFormInput, { type: 'server', message });
      }
    }
    setFormError(
      result.hint === undefined
        ? { message: result.message }
        : { message: result.message, hint: result.hint },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Progres {row.code} — {periodLabel}
          </DialogTitle>
          <DialogDescription>
            Capaian periode ini saja, bukan kumulatif. Sudah selesai{' '}
            {formatPercent(row.completedBefore, 2)} pada periode lain; sisa yang dapat dilaporkan{' '}
            {formatPercent(row.remaining, 2)}.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onValid)} className="space-y-4" noValidate>
          <input type="hidden" {...register('method')} />

          {formError ? (
            <Alert variant="destructive">
              <AlertTitle>{formError.message}</AlertTitle>
              {formError.hint ? <AlertDescription>{formError.hint}</AlertDescription> : null}
            </Alert>
          ) : null}

          {byVolume ? (
            <TextField
              id="qtyThisPeriod"
              label={`Kuantitas periode ini (${row.unitCode})`}
              inputMode="decimal"
              hint={`Volume total pekerjaan ${formatQuantity(row.volume)} ${row.unitCode}.`}
              error={messageOf('qtyThisPeriod')}
              registration={register('qtyThisPeriod')}
            />
          ) : (
            <TextField
              id="pctInput"
              label="Capaian periode ini (%)"
              inputMode="decimal"
              hint="Diisi dalam persen, misal 25 untuk seperempat pekerjaan."
              error={messageOf('pctInput')}
              registration={register('pctInput')}
            />
          )}

          {preview !== null ? (
            <p className={overshoots ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
              Setara {formatPercent(preview, 2)} dari pekerjaan ini.
              {overshoots
                ? ' Melebihi sisa yang tersedia — kumulatif tidak boleh melewati 100%.'
                : null}
            </p>
          ) : null}

          <TextField
            id="entryDate"
            label="Tanggal catat"
            type="date"
            error={messageOf('entryDate')}
            registration={register('entryDate')}
          />

          {/*
            Kept apart from the note, because it is the field an opname
            argument turns on: two entries against the same item in the same
            period are otherwise indistinguishable, and a free-text note is
            where such things go to be lost.
          */}
          <TextField
            id="progress-location"
            label="Lokasi"
            hint="Contoh: Lantai 2, as A-B. Membuat catatan ini dapat diperiksa ulang sebulan kemudian."
            error={messageOf('location')}
            registration={register('location')}
          />

          <TextAreaField
            id="progress-note"
            label="Catatan"
            rows={2}
            error={messageOf('note')}
            registration={register('note')}
          />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {isSubmitting ? 'Menyimpan…' : 'Simpan draf'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
