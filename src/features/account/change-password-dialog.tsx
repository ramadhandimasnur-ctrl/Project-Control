'use client';

import { KeyRound, Loader2 } from 'lucide-react';
import { useActionState, useEffect } from 'react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { changePasswordAction, type AccountFormState } from './actions';

const INITIAL: AccountFormState = {};

/**
 * Changing your own password without going through the email flow.
 *
 * The reset link exists for people who cannot get in. Someone already signed
 * in should not have to lock themselves out and wait for an email to change a
 * password they simply want to rotate.
 */
export function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [state, formAction, pending] = useActionState(changePasswordAction, INITIAL);

  /*
   * Closed on success rather than left open showing a green box. The dialog
   * has done its job, and the toast carries the confirmation to a place the
   * user is still looking after it disappears.
   */
  useEffect(() => {
    if (!state.notice) return;
    toast.success('Kata sandi berhasil diganti.', { description: state.notice });
    onOpenChange(false);
  }, [state.notice, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ganti kata sandi</DialogTitle>
          <DialogDescription>
            Masukkan kata sandi saat ini untuk memastikan ini benar-benar Anda, lalu pilih kata
            sandi baru.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-4" noValidate>
          {state.error ? (
            <Alert variant="destructive">
              <AlertTitle>{state.error}</AlertTitle>
              {state.hint ? <AlertDescription>{state.hint}</AlertDescription> : null}
            </Alert>
          ) : null}

          <Field
            id="currentPassword"
            label="Kata sandi saat ini"
            autoComplete="current-password"
            error={state.fieldErrors?.currentPassword}
          />
          <Field
            id="password"
            label="Kata sandi baru"
            autoComplete="new-password"
            hint="Minimal 8 karakter."
            error={state.fieldErrors?.password}
          />
          <Field
            id="confirmPassword"
            label="Ulangi kata sandi baru"
            autoComplete="new-password"
            error={state.fieldErrors?.confirmPassword}
          />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <KeyRound className="size-4" aria-hidden />
              )}
              {pending ? 'Menyimpan…' : 'Simpan kata sandi'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  id,
  label,
  autoComplete,
  hint,
  error,
}: {
  id: string;
  label: string;
  autoComplete: string;
  hint?: string;
  error?: string;
}) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={id}
        type="password"
        autoComplete={autoComplete}
        required
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
      />
      {error ? (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
