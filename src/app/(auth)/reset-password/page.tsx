import type { Metadata } from 'next';
import Link from 'next/link';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { createSupabaseServerClient } from '@/lib/supabase/server';

import { ResetPasswordForm } from './reset-password-form';

export const metadata: Metadata = { title: 'Kata Sandi Baru' };

/**
 * Reached from the link in the reset email, after `/auth/callback` has turned
 * its code into a session.
 *
 * The session is checked here as well as in the action. Someone who opens this
 * URL directly — or whose link has expired — should be told so on arrival
 * rather than after typing a password twice.
 */
export default async function ResetPasswordPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="w-full max-w-sm space-y-4">
        <Alert variant="destructive">
          <AlertTitle>Tautan tidak berlaku</AlertTitle>
          <AlertDescription>
            Tautan pengaturan ulang sudah kedaluwarsa, sudah dipakai, atau dibuka di peramban yang
            berbeda dari tempat permintaannya dikirim.
          </AlertDescription>
        </Alert>
        <p className="text-center text-sm text-muted-foreground">
          <Link
            href="/forgot-password"
            className="font-medium text-foreground underline underline-offset-4"
          >
            Minta tautan baru
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm">
      <ResetPasswordForm />
    </div>
  );
}
