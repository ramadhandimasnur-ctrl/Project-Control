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
import { Switch } from '@/components/ui/switch';
import { SelectField, TextField } from '@/features/master-data/form-fields';
import {
  WORK_ITEM_FORM_DEFAULTS,
  workItemFormSchema,
  type WorkItemFormInput,
  type WorkItemFormValues,
} from '@/lib/validation/work-breakdown';

import { saveWorkItemAction } from './actions';

const PROGRESS_METHOD_OPTIONS = [
  { value: 'VOLUME', label: 'Volume — progres dari kuantitas yang dikerjakan' },
  { value: 'PERCENT', label: 'Persen — progres diisi langsung' },
  { value: 'MILESTONE', label: 'Milestone — progres dari tahapan yang selesai' },
];

export function WorkItemDialog({
  open,
  onOpenChange,
  projectId,
  workItemId,
  defaultValues,
  units,
  groups,
  volumeLocked = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  workItemId: string | null;
  defaultValues?: WorkItemFormInput;
  units: { id: string; code: string; name: string }[];
  groups: { id: string; code: string; name: string }[];
  /** True when the volume comes from take-off rows and must not be typed over. */
  volumeLocked?: boolean;
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<{ message: string; hint?: string } | null>(null);

  const form = useForm<WorkItemFormInput, unknown, WorkItemFormValues>({
    resolver: zodResolver(workItemFormSchema),
    defaultValues: defaultValues ?? WORK_ITEM_FORM_DEFAULTS,
    mode: 'onBlur',
  });

  const {
    register,
    handleSubmit,
    setError,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = form;

  const messageOf = (field: keyof WorkItemFormInput): string | undefined => {
    const entry = errors[field];
    return typeof entry?.message === 'string' ? entry.message : undefined;
  };

  const onValid = async (values: WorkItemFormValues) => {
    setFormError(null);
    const result = await saveWorkItemAction(projectId, workItemId, values);

    if (result.ok) {
      toast.success(workItemId === null ? 'Pekerjaan dibuat.' : 'Perubahan tersimpan.');
      onOpenChange(false);
      router.refresh();
      return;
    }

    if (result.fieldErrors) {
      for (const [field, message] of Object.entries(result.fieldErrors)) {
        setError(field as keyof WorkItemFormInput, { type: 'server', message });
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
          <DialogTitle>{workItemId === null ? 'Tambah pekerjaan' : 'Ubah pekerjaan'}</DialogTitle>
          <DialogDescription>
            Harga satuan kontrak adalah otoritas pendapatan. Bila dikosongkan, nilai kontrak
            dihitung dari RAB ditambah markup proyek.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onValid)} className="space-y-4" noValidate>
          {formError ? (
            <Alert variant="destructive">
              <AlertTitle>{formError.message}</AlertTitle>
              {formError.hint ? <AlertDescription>{formError.hint}</AlertDescription> : null}
            </Alert>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
            <TextField
              id="wi-code"
              label="Kode"
              hint="Contoh: A.01"
              error={messageOf('code')}
              registration={register('code')}
            />
            <TextField
              id="wi-name"
              label="Uraian pekerjaan"
              error={messageOf('name')}
              registration={register('name')}
            />
          </div>

          <TextField
            id="wi-spec"
            label="Spesifikasi"
            error={messageOf('spec')}
            registration={register('spec')}
          />

          <div className="grid gap-4 sm:grid-cols-3">
            <SelectField
              id="groupId"
              label="Kelompok"
              error={messageOf('groupId')}
              registration={register('groupId')}
              placeholder="Tanpa kelompok"
              options={groups.map((g) => ({ value: g.id, label: `${g.code} — ${g.name}` }))}
            />
            <SelectField
              id="wi-unitId"
              label="Satuan"
              error={messageOf('unitId')}
              registration={register('unitId')}
              placeholder="Pilih satuan"
              options={units.map((u) => ({ value: u.id, label: `${u.code} — ${u.name}` }))}
            />
            <TextField
              id="volume"
              label="Volume"
              inputMode="decimal"
              disabled={volumeLocked}
              hint={
                volumeLocked
                  ? 'Diturunkan dari baris take-off, jadi tidak dapat diketik di sini.'
                  : undefined
              }
              error={messageOf('volume')}
              registration={register('volume')}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              id="contractUnitPrice"
              label="Harga satuan kontrak (Rp)"
              inputMode="decimal"
              hint="Kosongkan bila belum ada. Isi 0 bila pekerjaan ini memang tidak ditagih terpisah."
              error={messageOf('contractUnitPrice')}
              registration={register('contractUnitPrice')}
            />
            <TextField
              id="sortOrder"
              label="Urutan"
              type="number"
              min={0}
              error={messageOf('sortOrder')}
              registration={register('sortOrder')}
            />
          </div>

          <SelectField
            id="progressMethod"
            label="Metode progres"
            error={messageOf('progressMethod')}
            registration={register('progressMethod')}
            options={PROGRESS_METHOD_OPTIONS}
          />

          <label className="flex items-start justify-between gap-4 rounded-md border p-3">
            <span className="text-sm">
              <span className="font-medium">Ikut menentukan bobot progres</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Matikan untuk pekerjaan operasional: biayanya tetap dihitung, tetapi tidak menambah
                bobot progres.
              </span>
            </span>
            <Switch
              checked={watch('includeInProgressWeight')}
              onCheckedChange={(v) => setValue('includeInProgressWeight', v)}
            />
          </label>

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
