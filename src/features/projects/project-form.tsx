'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  projectFormSchema,
  type ProjectFormInput,
  type ProjectFormValues,
} from '@/lib/validation/project';

import { type ActionResult } from './actions';

type Props = {
  defaultValues: ProjectFormInput;
  submitLabel: string;
  onSubmitAction: (values: ProjectFormValues) => Promise<ActionResult>;
  canEditContractTerms: boolean;
};

const PERIOD_OPTIONS = [
  { value: 'DAY', label: 'Harian' },
  { value: 'WEEK', label: 'Mingguan' },
  { value: 'MONTH', label: 'Bulanan' },
] as const;

const WEIGHT_BASIS_OPTIONS = [
  { value: 'CONTRACT', label: 'Nilai kontrak', hint: 'Direkomendasikan: progres sebanding dengan nilai yang dapat ditagih.' },
  { value: 'RAB', label: 'RAB', hint: 'Bobot mengikuti estimasi anggaran internal.' },
  { value: 'RAP', label: 'RAP', hint: 'Bobot mengikuti rencana biaya pelaksanaan.' },
] as const;

const COST_RECOGNITION_OPTIONS = [
  { value: 'PURCHASE_BASED', label: 'Saat pembelian', hint: 'Biaya diakui ketika material dibeli.' },
  { value: 'CONSUMPTION_BASED', label: 'Saat pemakaian', hint: 'Biaya diakui ketika material dipakai. Hanya versi ini yang sah dibandingkan langsung dengan RAP earned.' },
] as const;

const STATUS_OPTIONS = [
  { value: 'DRAFT', label: 'Draf' },
  { value: 'ACTIVE', label: 'Aktif' },
  { value: 'ON_HOLD', label: 'Ditunda' },
  { value: 'CLOSED', label: 'Selesai' },
] as const;

export function ProjectForm({
  defaultValues,
  submitLabel,
  onSubmitAction,
  canEditContractTerms,
}: Props) {
  const [formError, setFormError] = useState<{ message: string; hint?: string } | null>(null);

  const form = useForm<ProjectFormInput, unknown, ProjectFormValues>({
    resolver: zodResolver(projectFormSchema),
    defaultValues,
    mode: 'onBlur',
  });

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = form;

  const onValid = async (values: ProjectFormValues) => {
    setFormError(null);
    const result = await onSubmitAction(values);

    if (result.ok) {
      toast.success('Perubahan tersimpan.');
      return;
    }

    if (result.fieldErrors) {
      for (const [name, message] of Object.entries(result.fieldErrors)) {
        setError(name as keyof ProjectFormInput, { type: 'server', message });
      }
    }
    setFormError(result.hint === undefined ? { message: result.message } : { message: result.message, hint: result.hint });
  };

  const fieldError = (name: keyof ProjectFormInput): string | undefined => {
    const entry = errors[name];
    return typeof entry?.message === 'string' ? entry.message : undefined;
  };

  const Field = ({
    name,
    label,
    hint,
    ...inputProps
  }: {
    name: keyof ProjectFormInput;
    label: string;
    hint?: string;
  } & React.ComponentProps<typeof Input>) => {
    const error = fieldError(name);
    return (
      <div className="space-y-2">
        <Label htmlFor={name}>{label}</Label>
        <Input
          id={name}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${name}-error` : hint ? `${name}-hint` : undefined}
          {...inputProps}
          {...register(name)}
        />
        {error ? (
          <p id={`${name}-error`} className="text-sm text-destructive">
            {error}
          </p>
        ) : hint ? (
          <p id={`${name}-hint`} className="text-xs text-muted-foreground">
            {hint}
          </p>
        ) : null}
      </div>
    );
  };

  const RadioGroup = <T extends string>({
    name,
    label,
    options,
  }: {
    name: keyof ProjectFormInput;
    label: string;
    options: readonly { value: T; label: string; hint?: string }[];
  }) => (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{label}</legend>
      <div className="space-y-2">
        {options.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-accent/40"
          >
            <input
              type="radio"
              value={option.value}
              className="mt-0.5 size-4 accent-primary"
              {...register(name)}
            />
            <span>
              <span className="font-medium">{option.label}</span>
              {option.hint ? (
                <span className="mt-0.5 block text-xs text-muted-foreground">{option.hint}</span>
              ) : null}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );

  return (
    <form onSubmit={handleSubmit(onValid)} className="space-y-6" noValidate>
      {formError ? (
        <Alert variant="destructive">
          <AlertTitle>{formError.message}</AlertTitle>
          {formError.hint ? <AlertDescription>{formError.hint}</AlertDescription> : null}
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Informasi proyek</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field name="code" label="Kode proyek" hint="Unik dalam organisasi, contoh: PRJ-2026-01." />
          <Field name="name" label="Nama proyek" />
          <Field name="contractNo" label="Nomor kontrak" />
          <Field name="ownerName" label="Pemilik / Owner" />
          <Field name="contractorName" label="Kontraktor" />
          <Field name="location" label="Lokasi" />
          <Field name="projectType" label="Jenis proyek" hint="Contoh: Gedung, Jalan, Irigasi." />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Kontrak & periode</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field
            name="contractValue"
            label="Nilai kontrak (Rp)"
            inputMode="decimal"
            disabled={!canEditContractTerms}
            hint={
              canEditContractTerms
                ? 'Tulis angka tanpa pemisah ribuan, contoh: 10000000000.'
                : 'Hanya Manajer Proyek yang dapat mengubah nilai kontrak.'
            }
          />
          <div />
          <Field name="startDate" label="Tanggal mulai" type="date" />
          <Field name="endDate" label="Tanggal selesai" type="date" />
          <RadioGroup name="periodType" label="Tipe periode pelaporan" options={PERIOD_OPTIONS} />
          <div />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Retensi & pajak</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field
            name="retentionPercent"
            label="Retensi (%)"
            inputMode="decimal"
            disabled={!canEditContractTerms}
            hint="Isi dalam persen, contoh: 5."
          />
          <Field
            name="retentionReleaseDays"
            label="Masa pemeliharaan (hari)"
            type="number"
            min={0}
            disabled={!canEditContractTerms}
          />
          <Field
            name="vatPercent"
            label="PPN (%)"
            inputMode="decimal"
            disabled={!canEditContractTerms}
          />
          <Field
            name="whtPercent"
            label="PPh (%)"
            inputMode="decimal"
            disabled={!canEditContractTerms}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Metode pengendalian</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-2">
          <RadioGroup
            name="progressWeightBasis"
            label="Dasar bobot progres"
            options={WEIGHT_BASIS_OPTIONS}
          />
          <RadioGroup
            name="costRecognition"
            label="Pengakuan biaya aktual"
            options={COST_RECOGNITION_OPTIONS}
          />
          <Field
            name="defaultMarkup"
            label="Markup default (%)"
            inputMode="decimal"
            hint="Dipakai bila sebuah pekerjaan belum memiliki harga satuan kontrak."
          />
          <div className="grid gap-4">
            <Field
              name="thresholdWarning"
              label="Ambang peringatan (%)"
              inputMode="decimal"
              hint="Negatif, contoh: -0,5 berarti deviasi -0,5%."
            />
            <Field
              name="thresholdDelayed"
              label="Ambang terlambat (%)"
              inputMode="decimal"
              hint="Negatif, contoh: -5."
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Aturan operasional</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-start justify-between gap-4 rounded-md border p-3">
            <span className="text-sm">
              <span className="font-medium">Ceklis mutu wajib sebelum persetujuan progres</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Progres tidak dapat disetujui selama hasil ceklis belum PASS.
              </span>
            </span>
            <Switch
              checked={form.watch('requireChecklistBeforeApprove')}
              onCheckedChange={(v) => form.setValue('requireChecklistBeforeApprove', v)}
            />
          </label>

          <label className="flex items-start justify-between gap-4 rounded-md border p-3">
            <span className="text-sm">
              <span className="font-medium">Izinkan stok negatif</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Biarkan nonaktif agar pengeluaran material melebihi stok ditolak.
              </span>
            </span>
            <Switch
              checked={form.watch('allowNegativeStock')}
              onCheckedChange={(v) => form.setValue('allowNegativeStock', v)}
            />
          </label>

          <RadioGroup name="status" label="Status proyek" options={STATUS_OPTIONS} />

          <div className="space-y-2">
            <Label htmlFor="notes">Catatan</Label>
            <Textarea id="notes" rows={3} {...register('notes')} />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {isSubmitting ? 'Menyimpan…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}
