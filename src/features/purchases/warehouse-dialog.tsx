'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
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
import { Switch } from '@/components/ui/switch';
import { TextField } from '@/features/master-data/form-fields';
import {
  WAREHOUSE_FORM_DEFAULTS,
  warehouseFormSchema,
  type WarehouseFormInput,
  type WarehouseFormValues,
} from '@/lib/validation/inventory';

import { saveWarehouseAction } from './actions';

export function WarehouseDialog({
  open,
  onOpenChange,
  projectId,
  warehouseId,
  defaultValues,
  /**
   * Whether the project has no warehouse yet. The service makes the first one
   * default regardless of the switch, so the form says so instead of offering
   * a choice that will be overruled.
   */
  isFirst = false,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  warehouseId: string | null;
  defaultValues?: WarehouseFormInput;
  isFirst?: boolean;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<{ message: string; hint?: string } | null>(null);

  const form = useForm<WarehouseFormInput, unknown, WarehouseFormValues>({
    resolver: zodResolver(warehouseFormSchema),
    defaultValues: defaultValues ?? { ...WAREHOUSE_FORM_DEFAULTS, isDefault: isFirst },
    mode: 'onBlur',
  });

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = form;

  const messageOf = (field: keyof WarehouseFormInput): string | undefined => {
    const entry = errors[field];
    return typeof entry?.message === 'string' ? entry.message : undefined;
  };

  const onValid = async (values: WarehouseFormValues) => {
    setFormError(null);
    const result = await saveWarehouseAction(projectId, warehouseId, values);

    if (result.ok) {
      toast.success(warehouseId === null ? 'Gudang dibuat.' : 'Perubahan tersimpan.', {
        description:
          warehouseId === null
            ? 'Sekarang pembelian dan mutasi punya tempat masuk.'
            : undefined,
      });
      onOpenChange(false);
      onSaved?.();
      router.refresh();
      return;
    }

    if (result.fieldErrors) {
      for (const [field, message] of Object.entries(result.fieldErrors)) {
        setError(field as keyof WarehouseFormInput, { type: 'server', message });
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
          <DialogTitle>{warehouseId === null ? 'Buat gudang' : 'Ubah gudang'}</DialogTitle>
          <DialogDescription>
            Gudang adalah tempat barang tercatat masuk dan keluar. Saldo stok dihitung per gudang,
            jadi pisahkan hanya bila memang lokasinya berbeda.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onValid)} className="space-y-4" noValidate>
          {formError ? (
            <Alert variant="destructive">
              <AlertTitle>{formError.message}</AlertTitle>
              {formError.hint ? <AlertDescription>{formError.hint}</AlertDescription> : null}
            </Alert>
          ) : null}

          <TextField
            id="warehouse-name"
            label="Nama gudang"
            placeholder="Gudang Utama"
            hint="Harus unik dalam proyek ini."
            error={messageOf('name')}
            registration={register('name')}
          />

          <TextField
            id="warehouse-location"
            label="Lokasi / keterangan"
            placeholder="Halaman belakang, dekat pos jaga"
            hint="Opsional. Membantu tim lapangan menemukan barangnya."
            error={messageOf('location')}
            registration={register('location')}
          />

          <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="warehouse-default">Jadikan gudang utama</Label>
              <p className="text-xs text-muted-foreground">
                {isFirst
                  ? 'Gudang pertama proyek otomatis menjadi gudang utama.'
                  : 'Dipilih lebih dulu pada baris pembelian dan mutasi baru. Hanya satu per proyek.'}
              </p>
            </div>
            <Controller
              control={control}
              name="isDefault"
              render={({ field }) => (
                <Switch
                  id="warehouse-default"
                  checked={isFirst ? true : Boolean(field.value)}
                  onCheckedChange={field.onChange}
                  disabled={isFirst}
                />
              )}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {isSubmitting ? 'Menyimpan…' : warehouseId === null ? 'Buat gudang' : 'Simpan'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
