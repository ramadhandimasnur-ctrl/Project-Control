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
  SUPPLIER_FORM_DEFAULTS,
  supplierFormSchema,
  type SupplierFormInput,
  type SupplierFormValues,
} from '@/lib/validation/master-data';

import { saveSupplierAction } from './actions';
import { TextAreaField, TextField } from './form-fields';

export function SupplierDialog({
  open,
  onOpenChange,
  supplierId,
  defaultValues,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplierId: string | null;
  defaultValues?: SupplierFormInput;
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<{ message: string; hint?: string } | null>(null);

  const form = useForm<SupplierFormInput, unknown, SupplierFormValues>({
    resolver: zodResolver(supplierFormSchema),
    defaultValues: defaultValues ?? SUPPLIER_FORM_DEFAULTS,
    mode: 'onBlur',
  });

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = form;

  const messageOf = (field: keyof SupplierFormInput): string | undefined => {
    const entry = errors[field];
    return typeof entry?.message === 'string' ? entry.message : undefined;
  };

  const onValid = async (values: SupplierFormValues) => {
    setFormError(null);
    const result = await saveSupplierAction(supplierId, values);

    if (result.ok) {
      toast.success(supplierId === null ? 'Pemasok dibuat.' : 'Perubahan tersimpan.');
      onOpenChange(false);
      router.refresh();
      return;
    }

    if (result.fieldErrors) {
      for (const [field, message] of Object.entries(result.fieldErrors)) {
        setError(field as keyof SupplierFormInput, { type: 'server', message });
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
          <DialogTitle>{supplierId === null ? 'Tambah pemasok' : 'Ubah pemasok'}</DialogTitle>
          <DialogDescription>
            Termin kredit menggeser tanggal kas keluar pada proyeksi kebutuhan modal.
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
              id="supplier-code"
              label="Kode"
              error={messageOf('code')}
              registration={register('code')}
            />
            <TextField
              id="creditDays"
              label="Termin kredit (hari)"
              type="number"
              min={0}
              hint="0 berarti bayar tunai."
              error={messageOf('creditDays')}
              registration={register('creditDays')}
            />
          </div>

          <TextField
            id="supplier-name"
            label="Nama"
            error={messageOf('name')}
            registration={register('name')}
          />

          <TextField
            id="contact"
            label="Kontak"
            hint="Nama penanggung jawab, telepon, atau email."
            error={messageOf('contact')}
            registration={register('contact')}
          />

          <TextAreaField
            id="address"
            label="Alamat"
            rows={2}
            error={messageOf('address')}
            registration={register('address')}
          />

          <TextAreaField
            id="supplier-note"
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
              {isSubmitting ? 'Menyimpan…' : 'Simpan'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
