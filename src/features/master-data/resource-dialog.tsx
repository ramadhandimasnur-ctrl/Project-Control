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
  RESOURCE_FORM_DEFAULTS,
  resourceFormSchema,
  type ResourceFormInput,
  type ResourceFormValues,
} from '@/lib/validation/master-data';

import { saveResourceAction } from './actions';
import { SelectField, TextAreaField, TextField } from './form-fields';

export const RESOURCE_TYPE_OPTIONS = [
  { value: 'LABOR', label: 'Tenaga' },
  { value: 'MATERIAL', label: 'Material' },
  { value: 'EQUIPMENT', label: 'Alat' },
  { value: 'SUBCON', label: 'Subkon' },
  { value: 'PACKAGE', label: 'Paket' },
  { value: 'OVERHEAD', label: 'Operasional' },
];

export type ResourceDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null creates a new resource. */
  resourceId: string | null;
  defaultValues?: ResourceFormInput;
  units: { id: string; code: string; name: string }[];
  categories: { id: string; name: string }[];
  /** Locked once the resource is referenced anywhere. */
  unitLocked?: boolean;
};

export function ResourceDialog({
  open,
  onOpenChange,
  resourceId,
  defaultValues,
  units,
  categories,
  unitLocked = false,
}: ResourceDialogProps) {
  const router = useRouter();
  const [formError, setFormError] = useState<{ message: string; hint?: string } | null>(null);

  const form = useForm<ResourceFormInput, unknown, ResourceFormValues>({
    resolver: zodResolver(resourceFormSchema),
    defaultValues: defaultValues ?? RESOURCE_FORM_DEFAULTS,
    mode: 'onBlur',
  });

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = form;

  const messageOf = (field: keyof ResourceFormInput): string | undefined => {
    const entry = errors[field];
    return typeof entry?.message === 'string' ? entry.message : undefined;
  };

  const onValid = async (values: ResourceFormValues) => {
    setFormError(null);
    const result = await saveResourceAction(resourceId, values);

    if (result.ok) {
      toast.success(resourceId === null ? 'Sumber daya dibuat.' : 'Perubahan tersimpan.');
      onOpenChange(false);
      // No reset needed: the parent unmounts the dialog when it closes, so the
      // next opening starts from fresh defaults.
      router.refresh();
      return;
    }

    if (result.fieldErrors) {
      for (const [field, message] of Object.entries(result.fieldErrors)) {
        setError(field as keyof ResourceFormInput, { type: 'server', message });
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
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {resourceId === null ? 'Tambah sumber daya' : 'Ubah sumber daya'}
          </DialogTitle>
          <DialogDescription>
            Kode dipakai saat menyusun analisa pekerjaan, jadi buat yang mudah diketik.
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
              id="code"
              label="Kode"
              hint="Contoh: M.24, PI.07."
              error={messageOf('code')}
              registration={register('code')}
            />
            <SelectField
              id="type"
              label="Jenis"
              error={messageOf('type')}
              registration={register('type')}
              options={RESOURCE_TYPE_OPTIONS}
            />
          </div>

          <TextField
            id="name"
            label="Nama"
            error={messageOf('name')}
            registration={register('name')}
          />

          <TextField
            id="spec"
            label="Spesifikasi"
            hint="Contoh: polos ø12, 7,5.20.60."
            error={messageOf('spec')}
            registration={register('spec')}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              id="unitId"
              label="Satuan"
              error={messageOf('unitId')}
              registration={register('unitId')}
              placeholder="Pilih satuan"
              disabled={unitLocked}
              hint={
                unitLocked
                  ? 'Terkunci karena sumber daya ini sudah dipakai. Mengubahnya akan menafsirkan ulang koefisien dan kuantitas yang sudah tercatat.'
                  : undefined
              }
              options={units.map((u) => ({ value: u.id, label: `${u.code} — ${u.name}` }))}
            />
            <SelectField
              id="categoryId"
              label="Kategori"
              error={messageOf('categoryId')}
              registration={register('categoryId')}
              placeholder="Tanpa kategori"
              options={categories.map((c) => ({ value: c.id, label: c.name }))}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              id="leadTimeDays"
              label="Lead time (hari)"
              type="number"
              min={0}
              hint="Waktu tunggu pengadaan, dipakai proyeksi kebutuhan modal."
              error={messageOf('leadTimeDays')}
              registration={register('leadTimeDays')}
            />
          </div>

          <TextAreaField
            id="notes"
            label="Keterangan"
            hint="Merek, pemasok langganan, atau catatan lain."
            error={messageOf('notes')}
            registration={register('notes')}
          />

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
