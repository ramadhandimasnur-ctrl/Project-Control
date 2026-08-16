'use server';

import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import { db } from '@/db';
import { withBypass } from '@/db/context';
import { organizations, users } from '@/db/schema';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from '@/lib/validation/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  assertUsernameAvailable,
  notifyPendingRegistration,
  registrationTarget,
} from '@/services/users';

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

  /*
   * Credentials being right is not the same as being allowed in.
   *
   * The message is specific here, unlike the one above: the person has just
   * proved they own the account, so telling them it is awaiting approval
   * reveals nothing they did not already know, and "email atau kata sandi
   * salah" would send them round in circles changing a password that works.
   */
  const [row] = await db
    .select({ id: users.id, isActive: users.isActive, status: users.status })
    .from(users)
    .where(eq(users.id, data.user.id))
    .limit(1);

  if (!row || !row.isActive) {
    await supabase.auth.signOut();

    if (row?.status === 'PENDING') {
      return {
        error: 'Pendaftaran Anda belum disetujui.',
        hint: 'Administrator akan meninjau akun Anda dan menentukan perannya. Coba lagi nanti.',
      };
    }

    if (row?.status === 'REJECTED') {
      return {
        error: 'Pendaftaran Anda ditolak.',
        hint: 'Hubungi administrator bila menurut Anda ini keliru.',
      };
    }

    if (row?.status === 'DEACTIVATED') {
      return {
        error: 'Akun Anda dinonaktifkan.',
        hint: 'Hubungi administrator untuk mengaktifkannya kembali.',
      };
    }

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
    username: formData.get('username'),
    email: formData.get('email'),
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  });

  if (!parsed.success) {
    return { fieldErrors: fieldErrorsOf(parsed.error.issues) };
  }

  const { fullName, username, email, password } = parsed.data;

  /*
   * The username is checked before the auth account is created. Finding out
   * afterwards would leave a Supabase user with no application row behind it —
   * an account that can authenticate and can never be used.
   */
  try {
    await assertUsernameAvailable(username);
  } catch (error) {
    return {
      fieldErrors: {
        username: error instanceof Error ? error.message : 'Username tidak tersedia.',
      },
    };
  }

  const target = await registrationTarget();

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error || !data.user) {
    return {
      error: error?.message ?? 'Pendaftaran gagal.',
      hint: 'Coba lagi, atau gunakan email lain bila email ini sudah terdaftar.',
    };
  }

  const authUserId = data.user.id;

  /*
   * The first account of an empty deployment bootstraps: it creates the
   * organisation, administers it, and is active immediately. Someone has to be
   * able to approve the second account, and an installation nobody can ever
   * sign into is not safer — it is broken.
   *
   * Everyone after joins that organisation as PENDING with no role decided.
   * The role is chosen by a human at approval, which is the only moment anyone
   * decides what a stranger may see.
   */
  try {
    await withBypass(async (tx) => {
      const existing = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, authUserId))
        .limit(1);
      if (existing.length > 0) return;

      let orgId = target.orgId;

      if (orgId === null) {
        const [org] = await tx
          .insert(organizations)
          .values({ name: fullName })
          .returning({ id: organizations.id });

        if (!org) throw new Error('Organisasi gagal dibuat.');
        orgId = org.id;
      }

      await tx.insert(users).values({
        id: authUserId,
        orgId,
        email,
        fullName,
        username,
        globalRole: target.isFirstAccount ? 'ADMIN' : 'MEMBER',
        status: target.isFirstAccount ? 'ACTIVE' : 'PENDING',
        isActive: target.isFirstAccount,
      });
    });
  } catch {
    return {
      error: 'Akun berhasil dibuat, tetapi pendaftarannya gagal disimpan.',
      hint: 'Hubungi administrator agar akun Anda dilengkapi, atau coba daftar ulang.',
    };
  }

  if (target.isFirstAccount) {
    if (!data.session) {
      return {
        notice: 'Pendaftaran berhasil. Periksa email Anda untuk mengonfirmasi akun, lalu masuk.',
      };
    }
    redirect('/projects');
  }

  // Never allowed to fail the registration: the pending list is the record
  // that matters, and the email is a convenience on top of it.
  await notifyPendingRegistration({ fullName, username, email });

  // Signed out deliberately — sign-up may hand back a session, and a pending
  // account holding one would sit on a screen that refuses every query.
  await supabase.auth.signOut();

  return {
    notice:
      'Pendaftaran diterima dan menunggu persetujuan administrator. Anda akan dapat masuk setelah akun disetujui dan perannya ditentukan.',
  };
}

export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect('/login');
}

/**
 * Sends the reset link.
 *
 * The reply is the same whether or not the address is registered. Saying "email
 * tidak terdaftar" turns this form into a way to test which addresses hold
 * accounts — the same reasoning that keeps the sign-in error vague, and it
 * matters more here because this form needs no password to probe with.
 *
 * A failure from Supabase is swallowed for the same reason: a rate-limit or a
 * bounce would otherwise be reported for real addresses and not for made-up
 * ones, which answers the question the wording refuses to.
 */
export async function requestPasswordResetAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = forgotPasswordSchema.safeParse({ email: formData.get('email') });

  if (!parsed.success) {
    return { fieldErrors: fieldErrorsOf(parsed.error.issues) };
  }

  const supabase = await createSupabaseServerClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: passwordResetRedirectUrl(),
  });

  return {
    notice:
      'Bila email tersebut terdaftar, tautan untuk mengatur ulang kata sandi sudah dikirimkan. Periksa kotak masuk dan folder spam; tautannya berlaku satu jam.',
  };
}

/**
 * The link in the email lands on `/auth/callback`, which exchanges its code for
 * a session and forwards here. Absolute, because it is read by a mail client on
 * another machine.
 */
function passwordResetRedirectUrl(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? 'http://localhost:3000';
  return `${base}/auth/callback?next=/reset-password`;
}

/**
 * Sets the new password.
 *
 * Requires the recovery session the callback established — without it Supabase
 * has no one to change the password of, and the refusal says to start again
 * rather than leaving a form that silently does nothing.
 */
export async function resetPasswordAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = resetPasswordSchema.safeParse({
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  });

  if (!parsed.success) {
    return { fieldErrors: fieldErrorsOf(parsed.error.issues) };
  }

  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      error: 'Tautan pengaturan ulang sudah tidak berlaku.',
      hint: 'Mintalah tautan baru dari halaman "Lupa kata sandi".',
    };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });

  if (error) {
    return {
      error: 'Kata sandi gagal diperbarui.',
      hint: error.message,
    };
  }

  /*
   * Signed out on purpose. The recovery session was minted to prove ownership
   * of the mailbox, not to start a working day, and ending it here means the
   * new password is used at least once — which is how someone finds out
   * immediately if it is not the one they meant to set.
   */
  await supabase.auth.signOut();
  redirect('/login?reset=1');
}
