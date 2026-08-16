import type { Metadata } from 'next';
import Link from 'next/link';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Masuk' };

/** What the reset flow may have sent the visitor back here to be told. */
const NOTICES: Record<string, { title: string; body: string }> = {
  'tautan-kedaluwarsa': {
    title: 'Tautan pengaturan ulang tidak berlaku',
    body: 'Tautannya sudah kedaluwarsa, sudah dipakai, atau dibuka di peramban yang berbeda. Mintalah tautan baru.',
  },
  'tautan-tidak-lengkap': {
    title: 'Tautan tidak lengkap',
    body: 'Alamat yang dibuka tidak memuat kode pengaturan ulang. Salin ulang tautan dari email, atau minta tautan baru.',
  },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reset?: string; error?: string }>;
}) {
  const { next, reset, error } = await searchParams;
  const notice = error === undefined ? undefined : NOTICES[error];

  return (
    <div className="w-full max-w-sm space-y-4">
      {reset === '1' ? (
        <Alert>
          <AlertTitle>Kata sandi berhasil diperbarui</AlertTitle>
          <AlertDescription>Masuk menggunakan kata sandi baru Anda.</AlertDescription>
        </Alert>
      ) : null}

      {notice ? (
        <Alert variant="destructive">
          <AlertTitle>{notice.title}</AlertTitle>
          <AlertDescription>{notice.body}</AlertDescription>
        </Alert>
      ) : null}

      <LoginForm next={next} />

      <div className="space-y-1 text-center text-sm text-muted-foreground">
        <p>
          <Link
            href="/forgot-password"
            className="font-medium text-foreground underline underline-offset-4"
          >
            Lupa kata sandi?
          </Link>
        </p>
        <p>
          Belum punya akun?{' '}
          <Link
            href="/register"
            className="font-medium text-foreground underline underline-offset-4"
          >
            Buat Akun
          </Link>
        </p>
      </div>
    </div>
  );
}
