'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Wand2 } from 'lucide-react';
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
import { toDecimal } from '@/lib/calc/decimal';
import {
  PRICE_PAIR_FORM_DEFAULTS,
  pricePairFormSchema,
  type PricePairFormInput,
  type PricePairFormValues,
} from '@/lib/validation/master-data';

import { addPricePairAction } from './actions';
import { TextAreaField, TextField } from './form-fields';

/**
 * Both prices for one resource, in one submission.
 *
 * RAB and RAP are entered side by side and either may be left blank, which
 * means "leave that one alone" rather than "set it to zero". Previously the
 * dialog took one type at a time, so keeping a pair in step meant opening it
 * twice and remembering to use the same effective date.
 *
 * The markup is a convenience that fills RAB from RAP, and a remembered
 * preference — not a live derivation. The price book records what was agreed
 * on a date; recomputing RAB whenever it is read would rewrite last year's
 * budget the moment someone revised the margin.
 */
export function PriceDialog({
  open,
  onOpenChange,
  resourceId,
  resourceName,
  unitCode,
  defaultMarkupPercent,
  currentRap,
  currentRab,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resourceId: string;
  resourceName: string;
  unitCode: string;
  /** Markup remembered from last time, as a percentage string ("15"). */
  defaultMarkupPercent?: string | null;
  currentRap?: string | null;
  currentRab?: string | null;
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<{ message: string; hint?: string } | null>(null);

  const form = useForm<PricePairFormInput, unknown, PricePairFormValues>({
    resolver: zodResolver(pricePairFormSchema),
    defaultValues: {
      ...PRICE_PAIR_FORM_DEFAULTS,
      priceRap: currentRap ?? '',
      priceRab: currentRab ?? '',
      markupPercent: defaultMarkupPercent ?? '',
      effectiveFrom: new Date().toISOString().slice(0, 10),
    },
    mode: 'onBlur',
  });

  const {
    register,
    handleSubmit,
    setError,
    getValues,
    setValue,
    formState: { errors, isSubmitting },
  } = form;

  const messageOf = (field: keyof PricePairFormInput): string | undefined => {
    const entry = errors[field];
    return typeof entry?.message === 'string' ? entry.message : undefined;
  };

  /**
   * Fills RAB from RAP and the markup, on demand.
   *
   * Deliberately a button rather than a live effect: typing "4" on the way to
   * "48000" would otherwise rewrite the RAB field several times, and a figure
   * that changes while you are still looking at it is hard to trust.
   */
  const applyMarkup = () => {
    const rap = getValues('priceRap');
    const markup = getValues('markupPercent');

    const rapText = String(rap ?? '').trim();
    const markupText = String(markup ?? '').trim();

    if (rapText === '' || markupText === '') {
      toast.error('Isi harga RAP dan persentase markup terlebih dahulu.');
      return;
    }

    const rapValue = Number(rapText);
    const markupValue = Number(markupText);

    if (!Number.isFinite(rapValue) || !Number.isFinite(markupValue)) {
      toast.error('Harga RAP dan markup harus berupa angka.');
      return;
    }

    const derived = toDecimal(rapText)
      .times(toDecimal(1).plus(toDecimal(markupText).dividedBy(100)))
      .toDecimalPlaces(2);

    setValue('priceRab', derived.toString(), { shouldValidate: true });
    toast.success(`Harga RAB dihitung dari RAP + ${markupText}%.`);
  };

  const onValid = async (values: PricePairFormValues) => {
    setFormError(null);
    const result = await addPricePairAction(resourceId, values);

    if (result.ok) {
      toast.success('Harga tersimpan.');
      onOpenChange(false);
      router.refresh();
      return;
    }

    if (result.fieldErrors) {
      for (const [field, message] of Object.entries(result.fieldErrors)) {
        setError(field as keyof PricePairFormInput, { type: 'server', message });
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
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Harga RAB &amp; RAP</DialogTitle>
          <DialogDescription>
            {resourceName} — per {unitCode}. Harga lama tidak ditimpa; entri ini berlaku mulai
            tanggal yang Anda pilih. Kosongkan salah satu bila hanya ingin mengubah yang lain.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onValid)} className="space-y-4" noValidate>
          {formError ? (
            <Alert variant="destructive">
              <AlertTitle>{formError.message}</AlertTitle>
              {formError.hint ? <AlertDescription>{formError.hint}</AlertDescription> : null}
            </Alert>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              id="priceRap"
              label={`Harga RAP per ${unitCode} (Rp)`}
              inputMode="decimal"
              hint="Biaya pelaksanaan. Tanpa pemisah ribuan, contoh: 48000."
              error={messageOf('priceRap')}
              registration={register('priceRap')}
            />
            <TextField
              id="priceRab"
              label={`Harga RAB per ${unitCode} (Rp)`}
              inputMode="decimal"
              hint="Anggaran biaya. Dapat diisi sendiri atau dihitung dari markup."
              error={messageOf('priceRab')}
              registration={register('priceRab')}
            />
          </div>

          <div className="rounded-md border p-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-40">
                <TextField
                  id="markupPercent"
                  label="Markup RAB atas RAP (%)"
                  inputMode="decimal"
                  hint="Disimpan dan terisi otomatis lain kali. Kosongkan bila kedua harga berdiri sendiri."
                  error={messageOf('markupPercent')}
                  registration={register('markupPercent')}
                />
              </div>
              <Button type="button" variant="outline" onClick={applyMarkup}>
                <Wand2 className="size-4" aria-hidden />
                Hitung RAB
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Markup hanya mengisikan angkanya ke kolom RAB saat tombol ditekan. Harga yang
              tersimpan tetap angka yang tertulis di atas, bukan rumus — revisi markup di kemudian
              hari tidak mengubah harga yang sudah berlaku.
            </p>
          </div>

          <TextField
            id="effectiveFrom"
            label="Berlaku sejak"
            type="date"
            hint="Estimasi bertanggal sebelum ini tetap memakai harga lama."
            error={messageOf('effectiveFrom')}
            registration={register('effectiveFrom')}
          />

          <TextField
            id="source"
            label="Sumber"
            hint="Contoh: penawaran supplier, survei pasar, jurnal harga."
            error={messageOf('source')}
            registration={register('source')}
          />

          <TextAreaField
            id="note"
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
              Simpan
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
