'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { applyPriceEdit, type PriceMode } from '@/lib/calc/markup';
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
  volumeLocked = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  workItemId: string | null;
  defaultValues?: WorkItemFormInput;
  units: { id: string; code: string; name: string }[];
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
    getValues,
    formState: { errors, isSubmitting },
  } = form;

  /*
   * The same three-way binding the catalogue uses, from the same pure module,
   * so a price typed here behaves exactly as one typed there.
   */
  const priceMode = useRef<PriceMode>(defaultValues?.priceMarkupPercent ? 'markup' : 'rab');

  /*
   * True once the execution volume has been given a value of its own, after
   * which the contracted volume stops writing into it. An item that already
   * stores a distinct RAP volume counts as touched from the moment it opens —
   * otherwise correcting the RAB volume would quietly discard the difference
   * somebody entered on purpose.
   */
  const volumeRapTouched = useRef(String(defaultValues?.volumeRap ?? '').trim() !== '');

  const onVolumeEdit = (value: string) => {
    if (volumeRapTouched.current) return;
    setValue('volumeRap', value, { shouldValidate: false });
  };

  /** The execution unit follows the contracted one on the same terms. */
  const unitRapTouched = useRef(String(defaultValues?.unitRapId ?? '').trim() !== '');

  const onUnitEdit = (value: string) => {
    if (unitRapTouched.current) return;
    setValue('unitRapId', value, { shouldValidate: false });
  };

  const onPriceEdit = (field: 'rap' | 'rab' | 'markup', value: string) => {
    const current = {
      rap: String(getValues('unitPriceRap') ?? ''),
      rab: String(getValues('unitPriceRab') ?? ''),
      markup: String(getValues('priceMarkupPercent') ?? ''),
    };

    const result = applyPriceEdit(current, field, value, priceMode.current);
    priceMode.current = result.mode;

    if (result.next.rab !== current.rab) {
      setValue('unitPriceRab', result.next.rab, { shouldValidate: false });
    }
    if (result.next.markup !== current.markup) {
      setValue('priceMarkupPercent', result.next.markup, { shouldValidate: false });
    }
  };

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
            Volume dan satuan menentukan besaran pekerjaan; biayanya dihitung dari analisa AHSP.
            Nilai kontrak diturunkan dari RAB ditambah markup proyek.
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

          {/*
            Kelompok and Harga satuan kontrak are deliberately absent from this
            form. Both columns still exist and still matter, so their values
            ride along in the form state untouched — react-hook-form keeps the
            defaults of fields it was never asked to render, which means editing
            a work item here cannot silently blank a contract price somebody
            entered before.
          */}
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              id="wi-unitId"
              label="Satuan RAB"
              error={messageOf('unitId')}
              registration={{
                ...register('unitId'),
                onChange: async (event: React.ChangeEvent<HTMLSelectElement>) => {
                  await register('unitId').onChange(event);
                  onUnitEdit(event.target.value);
                },
              }}
              placeholder="Pilih satuan"
              options={units.map((u) => ({ value: u.id, label: `${u.code} — ${u.name}` }))}
            />
            <TextField
              id="volume"
              label="Volume RAB"
              inputMode="decimal"
              disabled={volumeLocked}
              hint={
                volumeLocked
                  ? 'Diturunkan dari baris take-off, jadi tidak dapat diketik di sini.'
                  : 'Volume kontrak: dasar nilai kontrak dan bobot progres.'
              }
              error={messageOf('volume')}
              registration={{
                ...register('volume'),
                onChange: async (event: React.ChangeEvent<HTMLInputElement>) => {
                  await register('volume').onChange(event);
                  onVolumeEdit(event.target.value);
                },
              }}
            />
          </div>

          {/*
            The execution volume, filled from the contracted one until somebody
            says otherwise. Copying it forward only while it is untouched is the
            whole trick: the common case needs no second entry, and the rare
            line that genuinely differs is not overwritten the next time the
            contracted volume is corrected.
          */}
          <div className="grid gap-4 sm:grid-cols-2">
            {/*
              The execution unit is a measure of its own, not a conversion of
              the contracted one: galian sold by compacted m3 may be run by
              loose m3 or by the truckload. Nothing converts between them —
              a factor invented here would be a number nobody agreed to — so
              the RAP coefficients are simply written per this unit.
            */}
            <SelectField
              id="unitRapId"
              label="Satuan RAP"
              error={messageOf('unitRapId')}
              registration={{
                ...register('unitRapId'),
                onChange: async (event: React.ChangeEvent<HTMLSelectElement>) => {
                  await register('unitRapId').onChange(event);
                  unitRapTouched.current = event.target.value.trim() !== '';
                },
              }}
              placeholder="Ikut satuan RAB"
              options={units.map((u) => ({ value: u.id, label: `${u.code} — ${u.name}` }))}
            />
            <TextField
              id="volumeRap"
              label="Volume RAP"
              inputMode="decimal"
              hint="Volume yang direncanakan dikerjakan. Kosongkan bila sama dengan volume RAB."
              error={messageOf('volumeRap')}
              registration={{
                ...register('volumeRap'),
                onChange: async (event: React.ChangeEvent<HTMLInputElement>) => {
                  await register('volumeRap').onChange(event);
                  volumeRapTouched.current = event.target.value.trim() !== '';
                },
              }}
            />
          </div>

          {/*
            Direct prices, for lines that carry no AHSP.
            Markup and RAB are two ends of one relationship, so editing either
            derives the other while RAP stays authoritative — the same rule the
            catalogue table follows, from the same module.
          */}
          <div className="rounded-md border p-3">
            <p className="mb-2 text-xs text-muted-foreground">
              Harga satuan langsung, dipakai hanya bila pekerjaan ini tidak punya analisa AHSP.
              Begitu ada baris analisa, harga di sini diabaikan dan angkanya dihitung dari analisa
              itu.
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              <TextField
                id="unitPriceRap"
                label="Harga RAP"
                inputMode="decimal"
                error={messageOf('unitPriceRap')}
                registration={{
                  ...register('unitPriceRap'),
                  onChange: async (event: React.ChangeEvent<HTMLInputElement>) => {
                    await register('unitPriceRap').onChange(event);
                    onPriceEdit('rap', event.target.value);
                  },
                }}
              />
              <TextField
                id="unitPriceRab"
                label="Harga RAB"
                inputMode="decimal"
                error={messageOf('unitPriceRab')}
                registration={{
                  ...register('unitPriceRab'),
                  onChange: async (event: React.ChangeEvent<HTMLInputElement>) => {
                    await register('unitPriceRab').onChange(event);
                    onPriceEdit('rab', event.target.value);
                  },
                }}
              />
              <TextField
                id="priceMarkupPercent"
                label="Markup (%)"
                inputMode="decimal"
                error={messageOf('priceMarkupPercent')}
                registration={{
                  ...register('priceMarkupPercent'),
                  onChange: async (event: React.ChangeEvent<HTMLInputElement>) => {
                    await register('priceMarkupPercent').onChange(event);
                    onPriceEdit('markup', event.target.value);
                  },
                }}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              id="progressMethod"
              label="Metode progres"
              error={messageOf('progressMethod')}
              registration={register('progressMethod')}
              options={PROGRESS_METHOD_OPTIONS}
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
