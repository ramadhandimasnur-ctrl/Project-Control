'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
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
import {
  ComboboxField,
  SelectField,
  TextAreaField,
  TextField,
} from '@/features/master-data/form-fields';
import {
  AHSP_LINE_FORM_DEFAULTS,
  AHSP_ROLE_LABELS,
  AHSP_ROLE_ORDER,
  ahspLineFormSchema,
  type AhspLineFormInput,
  type AhspLineFormValues,
} from '@/lib/validation/work-breakdown';

import { saveAhspLineAction } from './actions';

export function AhspLineDialog({
  open,
  onOpenChange,
  projectId,
  workItemId,
  lineId,
  defaultRole,
  defaultValues,
  resources,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  workItemId: string;
  lineId: string | null;
  defaultRole: AhspLineFormInput['role'];
  defaultValues?: AhspLineFormInput;
  resources: { id: string; code: string; name: string; spec: string | null; unitCode: string }[];
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<{ message: string; hint?: string } | null>(null);

  const form = useForm<AhspLineFormInput, unknown, AhspLineFormValues>({
    resolver: zodResolver(ahspLineFormSchema),
    defaultValues: defaultValues ?? { ...AHSP_LINE_FORM_DEFAULTS, role: defaultRole },
    mode: 'onBlur',
  });

  const {
    register,
    control,
    handleSubmit,
    setError,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = form;

  // Built once per resource list so typing does not rebuild 379 objects.
  const resourceOptions = useMemo(
    () =>
      resources.map((r) => ({
        value: r.id,
        code: r.code,
        label: r.name,
        ...(r.spec ? { description: r.spec } : {}),
        meta: r.unitCode,
      })),
    [resources],
  );

  const messageOf = (field: keyof AhspLineFormInput): string | undefined => {
    const entry = errors[field];
    return typeof entry?.message === 'string' ? entry.message : undefined;
  };

  const selected = resources.find((r) => r.id === watch('resourceId'));

  const onValid = async (values: AhspLineFormValues) => {
    setFormError(null);
    const result = await saveAhspLineAction(projectId, workItemId, lineId, values);

    if (result.ok) {
      toast.success(lineId === null ? 'Baris analisa ditambahkan.' : 'Perubahan tersimpan.');
      onOpenChange(false);
      router.refresh();
      return;
    }

    if (result.fieldErrors) {
      for (const [field, message] of Object.entries(result.fieldErrors)) {
        setError(field as keyof AhspLineFormInput, { type: 'server', message });
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{lineId === null ? 'Tambah baris analisa' : 'Ubah baris analisa'}</DialogTitle>
          <DialogDescription>
            Pilih sumber daya, lalu isi koefisiennya saja. Satuan dan harga diambil dari master
            data dan tidak perlu diketik ulang.
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
            Controller rather than register: the combobox is not a native form
            element, so react-hook-form drives it by value instead of by ref.
          */}
          <Controller
            control={control}
            name="resourceId"
            render={({ field }) => (
              <ComboboxField
                id="resourceId"
                label="Sumber daya"
                error={messageOf('resourceId')}
                value={field.value ?? ''}
                onChange={field.onChange}
                placeholder="Pilih sumber daya"
                searchPlaceholder="Ketik kode atau nama, misal: M.24 atau besi"
                emptyMessage="Tidak ada sumber daya yang cocok."
                options={resourceOptions}
                hint={
                  selected
                    ? `Satuan: ${selected.unitCode}`
                    : `${resources.length} sumber daya tersedia. Ketik untuk menyaring.`
                }
              />
            )}
          />

          <SelectField
            id="role"
            label="Bagian analisa"
            error={messageOf('role')}
            registration={register('role')}
            options={AHSP_ROLE_ORDER.map((role) => ({ value: role, label: AHSP_ROLE_LABELS[role] }))}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              id="coefRap"
              label="Koefisien RAP"
              inputMode="decimal"
              hint="Koefisien pelaksanaan."
              error={messageOf('coefRap')}
              registration={register('coefRap')}
            />
            <TextField
              id="coefRab"
              label="Koefisien RAB"
              inputMode="decimal"
              hint="Kosongkan sama dengan RAP bila tidak dibedakan."
              error={messageOf('coefRab')}
              registration={register('coefRab')}
            />
          </div>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-mt-2"
            onClick={() => setValue('coefRab', watch('coefRap'), { shouldValidate: true })}
          >
            Samakan koefisien RAB dengan RAP
          </Button>

          <TextField
            id="wasteFactor"
            label="Faktor susut (%)"
            inputMode="decimal"
            hint="Contoh: 5 berarti kebutuhan ditambah 5%."
            error={messageOf('wasteFactor')}
            registration={register('wasteFactor')}
          />

          <TextAreaField
            id="line-note"
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
