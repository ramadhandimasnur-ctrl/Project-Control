'use server';

import { createClient } from '@supabase/supabase-js';

import { publicEnv } from '@/lib/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { changePasswordSchema } from '@/lib/validation/auth';

export type AccountFormState = {
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

/**
 * Changes the signed-in user's own password.
 *
 * The current password is verified first, against a throwaway Supabase client
 * that holds no cookies. Verifying through the session client would mint a new
 * session as a side effect of a check, and a failed check would leave the
 * caller's own session in a state nobody reasoned about. This one is created,
 * asked one question, and discarded.
 *
 * Supabase itself does not require the old password here — a session is enough
 * for `updateUser`. That is the wrong bar for this particular action: a session
 * can belong to an unlocked laptop, and a changed password locks the real owner
 * out for good. Knowing the old one is what distinguishes the account holder
 * from whoever is sitting at the desk.
 */
export async function changePasswordAction(
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get('currentPassword'),
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

  if (!user?.email) {
    return {
      error: 'Sesi Anda sudah berakhir.',
      hint: 'Masuk kembali, lalu ulangi penggantian kata sandi.',
    };
  }

  const env = publicEnv();
  const verifier = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error: wrongPassword } = await verifier.auth.signInWithPassword({
    email: user.email,
    password: parsed.data.currentPassword,
  });

  if (wrongPassword) {
    return { fieldErrors: { currentPassword: 'Kata sandi saat ini salah.' } };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });

  if (error) {
    return { error: 'Kata sandi gagal diperbarui.', hint: error.message };
  }

  /*
   * The session stays. This was a deliberate act by someone who just proved
   * they own the account, so signing them out would punish the good case — the
   * opposite of the reset flow, where the session existed only to prove a
   * mailbox and had no other business being open.
   */
  return {
    notice:
      'Kata sandi berhasil diganti. Gunakan kata sandi baru pada perangkat lain saat masuk berikutnya.',
  };
}
