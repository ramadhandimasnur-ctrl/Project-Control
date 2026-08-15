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
import {
  PRICE_FORM_DEFAULTS,
  priceFormSchema,
  type PriceFormInput,
  type PriceFormValues,
} from '@/lib/validation/master-data';

import { addPriceAction } from './actions';
import { SelectField, TextAreaField, TextField } from './form-fields';

const PRICE_TYPE_OPTIONS = [
  { value: 'RAP', label: 'RAP — rencana biaya pelaksanaan' },
  { value: 'RAB', label: 'RAB — anggaran biaya' },
];

export function PriceDialog({
  open,
  onOpenChange,
  resourceId,
  resourceName,
  unitCode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resourceId: string;
  resourceName: string;
  unitCode: string;
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<{ message: string; hint?: string } | null>(null);

  const form = useForm<PriceFormInput, unknown, PriceFormValues>({
    resolver: zodResolver(priceFormSchema),
    defaultValues: { ...PRICE_FORM_DEFAULTS, effectiveFrom: new Date().toISOString().slice(0, 10) },
    mode: 'onBlur',
  });

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = form;

  const messageOf = (field: keyof PriceFormInput): string | undefined => {
    const entry = errors[field];
    return typeof entry?.message === 'string' ? entry.message : undefined;
  };

  const onValid = async (values: PriceFormValues) => {
    setFormError(null);
    const result = await addPriceAction(resourceId, values);

    if (result.ok) {
      toast.success('Harga tersimpan.');
      onOpenChange(false);
      router.refresh();
      return;
    }

    if (result.fieldErrors) {
      for (const [field, message] of Object.entries(result.fieldErrors)) {
        setError(field as keyof PriceFormInput, { type: 'server', message });
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
          <DialogTitle>Tambah harga</DialogTitle>
          <DialogDescription>
            {resourceName} — per {unitCode}. Harga lama tidak ditimpa; entri ini berlaku mulai
            tanggal yang Anda pilih.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onValid)} className="space-y-4" noValidate>
          {formError ? (
            <Alert variant="destructive">
              <AlertTitle>{formError.message}</AlertTitle>
              {formError.hint ? <AlertDescription>{formError.hint}</AlertDescription> : null}
            </Alert>
          ) : null}

          <SelectField
            id="priceType"
            label="Jenis harga"
            error={messageOf('priceType')}
            registration={register('priceType')}
            options={PRICE_TYPE_OPTIONS}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              id="price"
              label={`Harga per ${unitCode} (Rp)`}
              inputMode="decimal"
              hint="Tanpa pemisah ribuan, contoh: 48000."
              error={messageOf('price')}
              registration={register('price')}
            />
            <TextField
              id="effectiveFrom"
              label="Berlaku sejak"
              type="date"
              hint="Estimasi bertanggal sebelum ini tetap memakai harga lama."
              error={messageOf('effectiveFrom')}
              registration={register('effectiveFrom')}
            />
          </div>

          <TextField
            id="source"
            label="Sumber"
            hint="Contoh: penawaran supplier, survei pasar, kontrak."
            error={messageOf('source')}
            registration={register('source')}
          />

          <TextAreaField
            id="price-note"
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
              {isSubmitting ? 'Menyimpan…' : 'Simpan harga'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
