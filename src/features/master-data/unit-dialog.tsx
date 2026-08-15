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
  UNIT_FORM_DEFAULTS,
  unitFormSchema,
  type UnitFormInput,
  type UnitFormValues,
} from '@/lib/validation/master-data';

import { saveUnitAction } from './actions';
import { SelectField, TextField } from './form-fields';

export const DIMENSION_OPTIONS = [
  { value: 'LENGTH', label: 'Panjang' },
  { value: 'AREA', label: 'Luas' },
  { value: 'VOLUME', label: 'Volume' },
  { value: 'MASS', label: 'Massa' },
  { value: 'COUNT', label: 'Jumlah' },
  { value: 'TIME', label: 'Waktu' },
  { value: 'LUMPSUM', label: 'Lumpsum' },
];

export function UnitDialog({
  open,
  onOpenChange,
  unitId,
  defaultValues,
  units,
  dimensionLocked = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  unitId: string | null;
  defaultValues?: UnitFormInput;
  /** Candidate base units; only same-dimension ones are valid. */
  units: { id: string; code: string; name: string; dimension: string }[];
  dimensionLocked?: boolean;
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<{ message: string; hint?: string } | null>(null);

  const form = useForm<UnitFormInput, unknown, UnitFormValues>({
    resolver: zodResolver(unitFormSchema),
    defaultValues: defaultValues ?? UNIT_FORM_DEFAULTS,
    mode: 'onBlur',
  });

  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = form;

  const messageOf = (field: keyof UnitFormInput): string | undefined => {
    const entry = errors[field];
    return typeof entry?.message === 'string' ? entry.message : undefined;
  };

  // Charter rule 8: conversion only ever happens inside one dimension, so the
  // base-unit list is narrowed rather than validated after the fact.
  const dimension = watch('dimension');
  const baseCandidates = units.filter((u) => u.dimension === dimension && u.id !== unitId);

  const onValid = async (values: UnitFormValues) => {
    setFormError(null);
    const result = await saveUnitAction(unitId, values);

    if (result.ok) {
      toast.success(unitId === null ? 'Satuan dibuat.' : 'Perubahan tersimpan.');
      onOpenChange(false);
      router.refresh();
      return;
    }

    if (result.fieldErrors) {
      for (const [field, message] of Object.entries(result.fieldErrors)) {
        setError(field as keyof UnitFormInput, { type: 'server', message });
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
          <DialogTitle>{unitId === null ? 'Tambah satuan' : 'Ubah satuan'}</DialogTitle>
          <DialogDescription>
            Dimensi menentukan apa yang diukur. Satuan berbeda dimensi tidak pernah dikonversi.
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
              id="unit-code"
              label="Kode"
              hint="Contoh: m3, btg, zak."
              error={messageOf('code')}
              registration={register('code')}
            />
            <TextField
              id="unit-name"
              label="Nama"
              error={messageOf('name')}
              registration={register('name')}
            />
          </div>

          <SelectField
            id="dimension"
            label="Dimensi"
            error={messageOf('dimension')}
            registration={register('dimension')}
            options={DIMENSION_OPTIONS}
            disabled={dimensionLocked}
            hint={
              dimensionLocked
                ? 'Terkunci karena satuan ini sudah dipakai sumber daya.'
                : undefined
            }
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              id="baseUnitId"
              label="Satuan dasar"
              error={messageOf('baseUnitId')}
              registration={register('baseUnitId')}
              placeholder="Tidak ada"
              options={baseCandidates.map((u) => ({ value: u.id, label: `${u.code} — ${u.name}` }))}
              hint={
                baseCandidates.length === 0
                  ? 'Belum ada satuan lain berdimensi sama.'
                  : 'Hanya satuan berdimensi sama yang dapat dipilih.'
              }
            />
            <TextField
              id="factorToBase"
              label="Faktor ke satuan dasar"
              inputMode="decimal"
              hint="Contoh: 1 ton = 1000 kg, maka faktornya 1000."
              error={messageOf('factorToBase')}
              registration={register('factorToBase')}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {isSubmitting ? 'Menyimpan…' : 'Simpan'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
