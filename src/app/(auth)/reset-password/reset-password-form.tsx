'use client';

import { Loader2 } from 'lucide-react';
import { useActionState } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { resetPasswordAction, type AuthFormState } from '../actions';

const INITIAL: AuthFormState = {};

export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState(resetPasswordAction, INITIAL);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Kata sandi baru</CardTitle>
        <CardDescription>
          Pilih kata sandi baru untuk akun Anda. Setelah tersimpan, Anda akan diminta masuk kembali
          menggunakan kata sandi itu.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4" noValidate>
          {state.error ? (
            <Alert variant="destructive">
              <AlertTitle>{state.error}</AlertTitle>
              {state.hint ? <AlertDescription>{state.hint}</AlertDescription> : null}
            </Alert>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="password">Kata sandi baru</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              aria-invalid={Boolean(state.fieldErrors?.password)}
              aria-describedby={state.fieldErrors?.password ? 'password-error' : 'password-hint'}
            />
            {state.fieldErrors?.password ? (
              <p id="password-error" className="text-sm text-destructive">
                {state.fieldErrors.password}
              </p>
            ) : (
              <p id="password-hint" className="text-xs text-muted-foreground">
                Minimal 8 karakter.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Ulangi kata sandi baru</Label>
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              aria-invalid={Boolean(state.fieldErrors?.confirmPassword)}
              aria-describedby={
                state.fieldErrors?.confirmPassword ? 'confirmPassword-error' : undefined
              }
            />
            {state.fieldErrors?.confirmPassword ? (
              <p id="confirmPassword-error" className="text-sm text-destructive">
                {state.fieldErrors.confirmPassword}
              </p>
            ) : null}
          </div>

          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {pending ? 'Menyimpan…' : 'Simpan kata sandi baru'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
