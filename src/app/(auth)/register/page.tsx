import type { Metadata } from 'next';
import Link from 'next/link';

import { RegisterForm } from './register-form';

export const metadata: Metadata = { title: 'Buat Akun' };

export default function RegisterPage() {
  return (
    <div className="w-full max-w-sm">
      <RegisterForm />
      <p className="mt-4 text-center text-sm text-muted-foreground">
        Sudah punya akun?{' '}
        <Link href="/login" className="font-medium text-foreground underline underline-offset-4">
          Masuk
        </Link>
      </p>
    </div>
  );
}
