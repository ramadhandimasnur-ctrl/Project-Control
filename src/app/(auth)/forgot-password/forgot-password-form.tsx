'use client';

import { Loader2, MailCheck } from 'lucide-react';
import { useActionState } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { requestPasswordResetAction, type AuthFormState } from '../actions';

const INITIAL: AuthFormState = {};

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(requestPasswordResetAction, INITIAL);

  /*
   * The form is replaced by the confirmation rather than sitting beneath it.
   * Leaving it in place invites a second and third submission from someone
   * waiting on an email that is already on its way.
   */
  if (state.notice) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Periksa email Anda</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <MailCheck className="size-4" aria-hidden />
            <AlertTitle>Permintaan diterima</AlertTitle>
            <AlertDescription>{state.notice}</AlertDescription>
          </Alert>
          <Button variant="outline" className="w-full" render={<a href="/login" />}>
            Kembali ke halaman masuk
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lupa kata sandi</CardTitle>
        <CardDescription>
          Masukkan email akun Anda. Kami kirimkan tautan untuk mengatur ulang kata sandinya.
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
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              aria-invalid={Boolean(state.fieldErrors?.email)}
              aria-describedby={state.fieldErrors?.email ? 'email-error' : undefined}
            />
            {state.fieldErrors?.email ? (
              <p id="email-error" className="text-sm text-destructive">
                {state.fieldErrors.email}
              </p>
            ) : null}
          </div>

          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {pending ? 'Mengirim…' : 'Kirim tautan reset'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
