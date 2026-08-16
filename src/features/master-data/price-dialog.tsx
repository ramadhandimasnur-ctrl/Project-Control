'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
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
 * Markup and RAB are two ends of one relationship, so editing either derives
 * the other while RAP stays authoritative and is never rewritten. What gets
 * saved is the number in the field, not the formula: the price book records
 * what was agreed on a date, and recomputing RAB whenever it is read would
 * rewrite last year's budget the moment someone revised the margin.
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

  /*
   * Which of the two derived fields the user is currently driving.
   *
   * RAB and markup describe the same relationship from opposite ends, so one
   * of them is always a consequence of the other. Remembering which was
   * touched last is what makes a later change to RAP behave predictably:
   * a user who set a 15% policy expects RAB to follow the cost, while a user
   * who typed a negotiated RAB expects that figure to stand and the
   * percentage to re-report itself.
   *
   * A ref rather than state: it steers the next keystroke and must never
   * trigger a render of its own.
   */
  const mode = useRef<'markup' | 'rab'>(defaultMarkupPercent ? 'markup' : 'rab');

  const numeric = (raw: unknown): string | null => {
    const text = String(raw ?? '').trim();
    if (text === '') return null;
    const value = Number(text);
    return Number.isFinite(value) ? text : null;
  };

  /** RAB from RAP and the markup. */
  const deriveRab = (rapText: string, markupText: string): string =>
    toDecimal(rapText)
      .times(toDecimal(1).plus(toDecimal(markupText).dividedBy(100)))
      .toDecimalPlaces(2)
      .toString();

  /**
   * Markup implied by a RAP and a RAB.
   *
   * Null when RAP is zero or absent: there is no percentage that turns nothing
   * into something, and writing Infinity into the field would be worse than
   * leaving the old number alone.
   */
  const deriveMarkup = (rapText: string, rabText: string): string | null => {
    const rap = toDecimal(rapText);
    if (rap.isZero()) return null;
    return toDecimal(rabText).dividedBy(rap).minus(1).times(100).toDecimalPlaces(2).toString();
  };

  const onMarkupChange = (raw: string) => {
    mode.current = 'markup';
    const rap = numeric(getValues('priceRap'));
    const markup = numeric(raw);
    if (rap === null || markup === null) return;
    setValue('priceRab', deriveRab(rap, markup), { shouldValidate: false });
  };

  const onRabChange = (raw: string) => {
    mode.current = 'rab';
    const rap = numeric(getValues('priceRap'));
    const rab = numeric(raw);
    if (rap === null || rab === null) return;
    const markup = deriveMarkup(rap, rab);
    if (markup !== null) setValue('markupPercent', markup, { shouldValidate: false });
  };

  /**
   * RAP is authoritative and never rewritten by the other two.
   *
   * Changing it updates whichever field is currently the consequence, so the
   * pair stays coherent without the cost figure ever moving on its own.
   */
  const onRapChange = (raw: string) => {
    const rap = numeric(raw);
    if (rap === null) return;

    if (mode.current === 'markup') {
      const markup = numeric(getValues('markupPercent'));
      if (markup !== null) setValue('priceRab', deriveRab(rap, markup), { shouldValidate: false });
      return;
    }

    const rab = numeric(getValues('priceRab'));
    if (rab === null) return;
    const markup = deriveMarkup(rap, rab);
    if (markup !== null) setValue('markupPercent', markup, { shouldValidate: false });
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

          {/*
            Three fields, two of them tied together. `registration` is spread
            first so the field stays controlled by react-hook-form, then the
            change handler runs after it — order matters, otherwise the form's
            own onChange overwrites ours and the pair never updates.
          */}
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              id="priceRap"
              label={`Harga RAP per ${unitCode} (Rp)`}
              inputMode="decimal"
              hint="Biaya pelaksanaan. Angka ini tidak pernah diubah otomatis."
              error={messageOf('priceRap')}
              registration={{
                ...register('priceRap'),
                onChange: async (event: React.ChangeEvent<HTMLInputElement>) => {
                  await register('priceRap').onChange(event);
                  onRapChange(event.target.value);
                },
              }}
            />
            <TextField
              id="priceRab"
              label={`Harga RAB per ${unitCode} (Rp)`}
              inputMode="decimal"
              hint="Ketik sendiri untuk menghitung ulang markup-nya."
              error={messageOf('priceRab')}
              registration={{
                ...register('priceRab'),
                onChange: async (event: React.ChangeEvent<HTMLInputElement>) => {
                  await register('priceRab').onChange(event);
                  onRabChange(event.target.value);
                },
              }}
            />
          </div>

          <div className="rounded-md border p-3">
            <TextField
              id="markupPercent"
              label="Markup RAB atas RAP (%)"
              inputMode="decimal"
              hint="Mengetik di sini menghitung ulang harga RAB. Kosongkan bila kedua harga berdiri sendiri."
              error={messageOf('markupPercent')}
              registration={{
                ...register('markupPercent'),
                onChange: async (event: React.ChangeEvent<HTMLInputElement>) => {
                  await register('markupPercent').onChange(event);
                  onMarkupChange(event.target.value);
                },
              }}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Markup dan harga RAB adalah dua sisi hubungan yang sama, jadi mengubah salah satunya
              menghitung ulang yang lain. Harga RAP tidak pernah ikut berubah. Yang tersimpan
              adalah angka yang tertulis di kolom, bukan rumusnya — merevisi markup di kemudian
              hari tidak menggeser harga yang sudah berlaku.
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
