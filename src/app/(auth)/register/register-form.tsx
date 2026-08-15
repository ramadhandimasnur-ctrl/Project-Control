'use client';

import { Loader2 } from 'lucide-react';
import { useActionState } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { registerAction, type AuthFormState } from '../actions';

const INITIAL: AuthFormState = {};

type Field = {
  name: 'organizationName' | 'fullName' | 'email' | 'password' | 'confirmPassword';
  label: string;
  type: string;
  autoComplete: string;
  hint?: string;
};

const FIELDS: Field[] = [
  {
    name: 'organizationName',
    label: 'Nama organisasi',
    type: 'text',
    autoComplete: 'organization',
    hint: 'Nama perusahaan atau badan usaha Anda.',
  },
  { name: 'fullName', label: 'Nama lengkap', type: 'text', autoComplete: 'name' },
  { name: 'email', label: 'Email', type: 'email', autoComplete: 'email' },
  {
    name: 'password',
    label: 'Kata sandi',
    type: 'password',
    autoComplete: 'new-password',
    hint: 'Minimal 8 karakter.',
  },
  {
    name: 'confirmPassword',
    label: 'Ulangi kata sandi',
    type: 'password',
    autoComplete: 'new-password',
  },
];

export function RegisterForm() {
  const [state, formAction, pending] = useActionState(registerAction, INITIAL);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Daftar organisasi baru</CardTitle>
        <CardDescription>
          Akun pertama menjadi administrator organisasi dan dapat menambahkan anggota lain.
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

          {state.notice ? (
            <Alert>
              <AlertTitle>Pendaftaran berhasil</AlertTitle>
              <AlertDescription>{state.notice}</AlertDescription>
            </Alert>
          ) : null}

          {FIELDS.map((field) => {
            const error = state.fieldErrors?.[field.name];
            return (
              <div key={field.name} className="space-y-2">
                <Label htmlFor={field.name}>{field.label}</Label>
                <Input
                  id={field.name}
                  name={field.name}
                  type={field.type}
                  autoComplete={field.autoComplete}
                  required
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? `${field.name}-error` : undefined}
                />
                {error ? (
                  <p id={`${field.name}-error`} className="text-sm text-destructive">
                    {error}
                  </p>
                ) : field.hint ? (
                  <p className="text-xs text-muted-foreground">{field.hint}</p>
                ) : null}
              </div>
            );
          })}

          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {pending ? 'Memproses…' : 'Daftar'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
