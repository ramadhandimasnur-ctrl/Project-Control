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
import { TextAreaField, TextField } from '@/features/master-data/form-fields';
import {
  TEMPLATE_FORM_DEFAULTS,
  templateFormSchema,
  type TemplateFormInput,
  type TemplateFormValues,
} from '@/lib/validation/work-breakdown';

import { saveTemplateAction } from './actions';

export function SaveTemplateDialog({
  open,
  onOpenChange,
  projectId,
  workItemId,
  workItemName,
  lineCount,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  workItemId: string;
  workItemName: string;
  lineCount: number;
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<{ message: string; hint?: string } | null>(null);

  const form = useForm<TemplateFormInput, unknown, TemplateFormValues>({
    resolver: zodResolver(templateFormSchema),
    defaultValues: { ...TEMPLATE_FORM_DEFAULTS, name: workItemName },
    mode: 'onBlur',
  });

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = form;

  const messageOf = (field: keyof TemplateFormInput): string | undefined => {
    const entry = errors[field];
    return typeof entry?.message === 'string' ? entry.message : undefined;
  };

  const onValid = async (values: TemplateFormValues) => {
    setFormError(null);
    const result = await saveTemplateAction(projectId, workItemId, values);

    if (result.ok) {
      toast.success('Template tersimpan.', {
        description: `${lineCount} baris analisa disalin ke pustaka organisasi.`,
      });
      onOpenChange(false);
      router.refresh();
      return;
    }

    if (result.fieldErrors) {
      for (const [field, message] of Object.entries(result.fieldErrors)) {
        setError(field as keyof TemplateFormInput, { type: 'server', message });
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
          <DialogTitle>Simpan sebagai template</DialogTitle>
          <DialogDescription>
            {lineCount} baris analisa dari &ldquo;{workItemName}&rdquo; disalin ke pustaka
            organisasi dan dapat dipakai di proyek mana pun.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onValid)} className="space-y-4" noValidate>
          {formError ? (
            <Alert variant="destructive">
              <AlertTitle>{formError.message}</AlertTitle>
              {formError.hint ? <AlertDescription>{formError.hint}</AlertDescription> : null}
            </Alert>
          ) : null}

          {/* The copy is frozen on purpose; saying so here prevents the
              reasonable assumption that the two stay linked. */}
          <Alert>
            <AlertTitle>Template adalah salinan beku</AlertTitle>
            <AlertDescription>
              Mengubah pekerjaan ini setelahnya tidak mengubah template, dan sebaliknya. Estimasi
              lama tetap dapat dijelaskan.
            </AlertDescription>
          </Alert>

          <TextField
            id="tpl-code"
            label="Kode template"
            hint="Contoh: TPL.BETON-K225"
            error={messageOf('code')}
            registration={register('code')}
          />

          <TextField
            id="tpl-name"
            label="Nama template"
            error={messageOf('name')}
            registration={register('name')}
          />

          <TextAreaField
            id="tpl-notes"
            label="Catatan"
            rows={2}
            hint="Misalnya sumber analisa atau asumsi yang dipakai."
            error={messageOf('notes')}
            registration={register('notes')}
          />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {isSubmitting ? 'Menyimpan…' : 'Simpan template'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
