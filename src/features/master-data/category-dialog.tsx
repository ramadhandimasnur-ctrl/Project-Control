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
  CATEGORY_FORM_DEFAULTS,
  categoryFormSchema,
  type CategoryFormInput,
  type CategoryFormValues,
} from '@/lib/validation/master-data';

import { saveCategoryAction } from './actions';
import { SelectField, TextField } from './form-fields';

export const RESOURCE_TYPE_OPTIONS = [
  { value: 'LABOR', label: 'Tenaga' },
  { value: 'MATERIAL', label: 'Material' },
  { value: 'EQUIPMENT', label: 'Alat' },
  { value: 'SUBCON', label: 'Subkon' },
  { value: 'PACKAGE', label: 'Paket' },
  { value: 'OVERHEAD', label: 'Operasional' },
];

export function CategoryDialog({
  open,
  onOpenChange,
  categoryId,
  defaultValues,
  categories,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categoryId: string | null;
  defaultValues?: CategoryFormInput;
  /** Candidate parents, already stripped of anything that would form a loop. */
  categories: { id: string; code: string; name: string }[];
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<{ message: string; hint?: string } | null>(null);

  const form = useForm<CategoryFormInput, unknown, CategoryFormValues>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: defaultValues ?? CATEGORY_FORM_DEFAULTS,
    mode: 'onBlur',
  });

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = form;

  const messageOf = (field: keyof CategoryFormInput): string | undefined => {
    const entry = errors[field];
    return typeof entry?.message === 'string' ? entry.message : undefined;
  };

  const onValid = async (values: CategoryFormValues) => {
    setFormError(null);
    const result = await saveCategoryAction(categoryId, values);

    if (result.ok) {
      toast.success(categoryId === null ? 'Kategori dibuat.' : 'Perubahan tersimpan.');
      onOpenChange(false);
      router.refresh();
      return;
    }

    if (result.fieldErrors) {
      for (const [field, message] of Object.entries(result.fieldErrors)) {
        setError(field as keyof CategoryFormInput, { type: 'server', message });
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
          <DialogTitle>{categoryId === null ? 'Tambah kategori' : 'Ubah kategori'}</DialogTitle>
          <DialogDescription>
            Kategori mengelompokkan sumber daya. Biarkan induk kosong untuk kategori tingkat atas.
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
              id="category-code"
              label="Kode"
              hint="Contoh: MAT-BESI."
              error={messageOf('code')}
              registration={register('code')}
            />
            <TextField
              id="category-name"
              label="Nama"
              error={messageOf('name')}
              registration={register('name')}
            />
          </div>

          <SelectField
            id="category-type"
            label="Jenis"
            error={messageOf('type')}
            registration={register('type')}
            options={RESOURCE_TYPE_OPTIONS}
          />

          <SelectField
            id="category-parent"
            label="Induk"
            hint="Kosongkan bila kategori ini berdiri sendiri."
            error={messageOf('parentId')}
            registration={register('parentId')}
            placeholder="— Tanpa induk —"
            options={categories.map((category) => ({
              value: category.id,
              label: `${category.code} · ${category.name}`,
            }))}
          />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Simpan
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
