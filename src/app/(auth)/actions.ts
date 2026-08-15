'use server';

import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import { db } from '@/db';
import { withBypass } from '@/db/context';
import { organizations, users } from '@/db/schema';
import { loginSchema, registerSchema } from '@/lib/validation/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export type AuthFormState = {
  error?: string;
  hint?: string;
  fieldErrors?: Record<string, string>;
  notice?: string;
};

function fieldErrorsOf(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? '');
    if (key && !out[key]) out[key] = issue.message;
  }
  return out;
}

export async function loginAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return { fieldErrors: fieldErrorsOf(parsed.error.issues) };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error || !data.user) {
    // Deliberately not distinguishing "unknown email" from "wrong password":
    // that difference tells an attacker which accounts exist.
    return {
      error: 'Email atau kata sandi salah.',
      hint: 'Periksa kembali, atau daftar bila Anda belum punya akun.',
    };
  }

  // A Supabase account with no active application row cannot proceed.
  const [row] = await db
    .select({ id: users.id, isActive: users.isActive })
    .from(users)
    .where(eq(users.id, data.user.id))
    .limit(1);

  if (!row || !row.isActive) {
    await supabase.auth.signOut();
    return {
      error: 'Akun Anda belum aktif di aplikasi ini.',
      hint: 'Hubungi administrator organisasi Anda.',
    };
  }

  const next = formData.get('next');
  redirect(typeof next === 'string' && next.startsWith('/') ? next : '/projects');
}

export async function registerAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = registerSchema.safeParse({
    fullName: formData.get('fullName'),
    organizationName: formData.get('organizationName'),
    email: formData.get('email'),
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  });

  if (!parsed.success) {
    return { fieldErrors: fieldErrorsOf(parsed.error.issues) };
  }

  const { fullName, organizationName, email, password } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error || !data.user) {
    return {
      error: error?.message ?? 'Pendaftaran gagal.',
      hint: 'Coba lagi, atau gunakan email lain bila email ini sudah terdaftar.',
    };
  }

  const authUserId = data.user.id;

  // The organisation and the application user are created together: a user
  // without an organisation cannot own anything, and would strand the account.
  try {
    await withBypass(async (tx) => {
      const existing = await tx.select({ id: users.id }).from(users).where(eq(users.id, authUserId)).limit(1);
      if (existing.length > 0) return;

      const [org] = await tx
        .insert(organizations)
        .values({ name: organizationName })
        .returning({ id: organizations.id });

      if (!org) throw new Error('Organisasi gagal dibuat.');

      await tx.insert(users).values({
        id: authUserId,
        orgId: org.id,
        email,
        fullName,
        // The first account of a new organisation administers it.
        globalRole: 'ADMIN',
      });
    });
  } catch {
    return {
      error: 'Akun berhasil dibuat, tetapi organisasi gagal disiapkan.',
      hint: 'Hubungi administrator agar akun Anda dilengkapi, atau coba daftar ulang.',
    };
  }

  // With email confirmation enabled in Supabase, sign-up returns no session.
  if (!data.session) {
    return {
      notice:
        'Pendaftaran berhasil. Periksa email Anda untuk mengonfirmasi akun, lalu masuk.',
    };
  }

  redirect('/projects');
}

export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect('/login');
}
