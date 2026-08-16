import type { Metadata } from 'next';
import Link from 'next/link';

import { ForgotPasswordForm } from './forgot-password-form';

export const metadata: Metadata = { title: 'Lupa Kata Sandi' };

export default function ForgotPasswordPage() {
  return (
    <div className="w-full max-w-sm">
      <ForgotPasswordForm />
      <p className="mt-4 text-center text-sm text-muted-foreground">
        Ingat kata sandinya?{' '}
        <Link href="/login" className="font-medium text-foreground underline underline-offset-4">
          Masuk
        </Link>
      </p>
    </div>
  );
}
