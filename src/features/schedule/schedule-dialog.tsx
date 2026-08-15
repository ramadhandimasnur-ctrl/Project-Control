'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Wand2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
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
import { ComboboxField, SelectField, TextField } from '@/features/master-data/form-fields';
import { durationBetween } from '@/lib/calc/schedule';
import {
  DEPENDENCY_LABELS,
  workItemScheduleFormSchema,
  type WorkItemScheduleFormInput,
  type WorkItemScheduleFormValues,
} from '@/lib/validation/schedule';
import { type GanttRow } from '@/services/schedule';

import { autoDistributeAction, saveWorkItemScheduleAction } from './actions';

export function ScheduleDialog({
  open,
  onOpenChange,
  projectId,
  row,
  options,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  row: GanttRow;
  options: { id: string; code: string; name: string }[];
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<{ message: string; hint?: string } | null>(null);
  const [distributing, startDistributing] = useTransition();

  const form = useForm<WorkItemScheduleFormInput, unknown, WorkItemScheduleFormValues>({
    resolver: zodResolver(workItemScheduleFormSchema),
    defaultValues: {
      plannedStart: row.plannedStart ?? '',
      plannedFinish: row.plannedFinish ?? '',
      predecessorId: row.predecessorId ?? '',
      dependencyType: row.dependencyType,
      lagDays: row.lagDays,
    },
    mode: 'onBlur',
  });

  const {
    register,
    control,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = form;

  const messageOf = (field: keyof WorkItemScheduleFormInput): string | undefined => {
    const entry = errors[field];
    return typeof entry?.message === 'string' ? entry.message : undefined;
  };

  const start = watch('plannedStart');
  const finish = watch('plannedFinish');

  // Shown live so the duration is never a surprise after saving.
  const duration = useMemo(() => {
    if (typeof start !== 'string' || typeof finish !== 'string') return null;
    if (start === '' || finish === '') return null;
    try {
      const days = durationBetween(start, finish);
      return days > 0 ? days : null;
    } catch {
      return null;
    }
  }, [start, finish]);

  const predecessorOptions = useMemo(
    () =>
      options.map((option) => ({
        value: option.id,
        code: option.code,
        label: option.name,
      })),
    [options],
  );

  const onValid = async (values: WorkItemScheduleFormValues) => {
    setFormError(null);
    const result = await saveWorkItemScheduleAction(projectId, row.workItemId, values);

    if (result.ok) {
      toast.success('Jadwal tersimpan.');
      onOpenChange(false);
      router.refresh();
      return;
    }

    if (result.fieldErrors) {
      for (const [field, message] of Object.entries(result.fieldErrors)) {
        setError(field as keyof WorkItemScheduleFormInput, { type: 'server', message });
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
          <DialogTitle>
            Jadwal {row.code} — {row.name}
          </DialogTitle>
          <DialogDescription>
            Tanggal di sini menentukan panjang batang pada Gantt dan menjadi dasar sebar otomatis.
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
              id="plannedStart"
              label="Mulai"
              type="date"
              error={messageOf('plannedStart')}
              registration={register('plannedStart')}
            />
            <TextField
              id="plannedFinish"
              label="Selesai"
              type="date"
              hint={duration === null ? undefined : `${duration} hari kalender.`}
              error={messageOf('plannedFinish')}
              registration={register('plannedFinish')}
            />
          </div>

          <Controller
            control={control}
            name="predecessorId"
            render={({ field }) => (
              <ComboboxField
                id="predecessorId"
                label="Pekerjaan pendahulu"
                error={messageOf('predecessorId')}
                value={typeof field.value === 'string' ? field.value : ''}
                onChange={field.onChange}
                placeholder="Tanpa pendahulu"
                searchPlaceholder="Ketik kode atau nama pekerjaan"
                emptyMessage="Tidak ada pekerjaan yang cocok."
                options={predecessorOptions}
                hint="Opsional. Dicatat sebagai urutan rencana; tanggal tidak digeser otomatis."
              />
            )}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              id="dependencyType"
              label="Jenis ketergantungan"
              error={messageOf('dependencyType')}
              registration={register('dependencyType')}
              options={Object.entries(DEPENDENCY_LABELS).map(([value, label]) => ({
                value,
                label,
              }))}
            />
            <TextField
              id="lagDays"
              label="Jeda (hari)"
              type="number"
              hint="Boleh negatif untuk tumpang tindih."
              error={messageOf('lagDays')}
              registration={register('lagDays')}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={distributing || row.plannedStart === null}
              title={
                row.plannedStart === null
                  ? 'Simpan tanggalnya terlebih dahulu.'
                  : 'Sebar 100% pekerjaan ini merata sepanjang tanggalnya.'
              }
              onClick={() =>
                startDistributing(async () => {
                  const result = await autoDistributeAction(projectId, row.workItemId);
                  if (result.ok) {
                    toast.success(`Tersebar ke ${result.cells} periode.`);
                    onOpenChange(false);
                    router.refresh();
                  } else {
                    toast.error(result.message, { description: result.hint });
                  }
                })
              }
            >
              {distributing ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Wand2 className="size-4" aria-hidden />
              )}
              Sebar otomatis
            </Button>
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
