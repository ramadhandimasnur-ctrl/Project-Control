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
import { TextField } from '@/features/master-data/form-fields';
import {
  duplicateWorkItemSchema,
  type DuplicateWorkItemInput,
  type DuplicateWorkItemValues,
} from '@/lib/validation/work-breakdown';

import { duplicateWorkItemAction } from './actions';

export function DuplicateWorkItemDialog({
  open,
  onOpenChange,
  projectId,
  workItemId,
  sourceCode,
  sourceName,
  ahspLineCount,
  takeoffCount,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  workItemId: string;
  sourceCode: string;
  sourceName: string;
  ahspLineCount: number;
  takeoffCount: number;
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<{ message: string; hint?: string } | null>(null);

  const form = useForm<DuplicateWorkItemInput, unknown, DuplicateWorkItemValues>({
    resolver: zodResolver(duplicateWorkItemSchema),
    defaultValues: {
      code: `${sourceCode}-2`,
      name: `${sourceName} (salinan)`,
      includeTakeoffs: takeoffCount > 0,
    },
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

  const messageOf = (field: keyof DuplicateWorkItemInput): string | undefined => {
    const entry = errors[field];
    return typeof entry?.message === 'string' ? entry.message : undefined;
  };

  const onValid = async (values: DuplicateWorkItemValues) => {
    setFormError(null);
    const result = await duplicateWorkItemAction(projectId, workItemId, values);

    if (result.ok) {
      toast.success('Pekerjaan diduplikasi.');
      onOpenChange(false);
      // Land on the copy, which is almost always what the user wants next.
      router.push(`/projects/${projectId}/work-items?item=${result.id}`);
      router.refresh();
      return;
    }

    if (result.fieldErrors) {
      for (const [field, message] of Object.entries(result.fieldErrors)) {
        setError(field as keyof DuplicateWorkItemInput, { type: 'server', message });
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
          <DialogTitle>Duplikat pekerjaan</DialogTitle>
          <DialogDescription>
            Menyalin &ldquo;{sourceName}&rdquo; beserta {ahspLineCount} baris analisanya.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onValid)} className="space-y-4" noValidate>
          {formError ? (
            <Alert variant="destructive">
              <AlertTitle>{formError.message}</AlertTitle>
              {formError.hint ? <AlertDescription>{formError.hint}</AlertDescription> : null}
            </Alert>
          ) : null}

          {/* Stating what is left behind matters more than what is copied:
              carrying progress across would fabricate site history. */}
          <Alert>
            <AlertTitle>Catatan lapangan tidak ikut disalin</AlertTitle>
            <AlertDescription>
              Entri progres dan transaksi material tetap milik pekerjaan asal. Salinan ini dimulai
              tanpa riwayat pelaksanaan.
            </AlertDescription>
          </Alert>

          <TextField
            id="dup-code"
            label="Kode pekerjaan baru"
            error={messageOf('code')}
            registration={register('code')}
          />

          <TextField
            id="dup-name"
            label="Uraian pekerjaan baru"
            error={messageOf('name')}
            registration={register('name')}
          />

          {takeoffCount > 0 ? (
            <label className="flex items-start justify-between gap-4 rounded-md border p-3">
              <span className="text-sm">
                <span className="font-medium">Salin juga {takeoffCount} baris volume take-off</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Bila disalin, volume salinan ikut diturunkan dari baris-baris itu. Bila tidak,
                  volumenya diisi manual.
                </span>
              </span>
              <Switch
                checked={watch('includeTakeoffs')}
                onCheckedChange={(v) => setValue('includeTakeoffs', v)}
              />
            </label>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {isSubmitting ? 'Menyalin…' : 'Duplikat'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
