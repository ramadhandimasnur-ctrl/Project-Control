import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().trim().min(1, 'Email wajib diisi.').email('Format email tidak valid.'),
  password: z.string().min(1, 'Kata sandi wajib diisi.'),
});

export const registerSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Nama lengkap wajib diisi.').max(200),
    /*
     * A handle, not a credential. Sign-in is by email; this is what other
     * people see. Restricted to characters that survive a URL and a printed
     * report without needing to be escaped.
     */
    username: z
      .string()
      .trim()
      .min(3, 'Username minimal 3 karakter.')
      .max(40, 'Username maksimal 40 karakter.')
      .regex(
        /^[a-zA-Z0-9._-]+$/,
        'Username hanya boleh berisi huruf, angka, titik, garis bawah, dan strip.',
      ),
    email: z.string().trim().min(1, 'Email wajib diisi.').email('Format email tidak valid.'),
    password: z
      .string()
      .min(8, 'Kata sandi minimal 8 karakter.')
      .max(72, 'Kata sandi maksimal 72 karakter.'),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Konfirmasi kata sandi tidak cocok.',
    path: ['confirmPassword'],
  });

export const forgotPasswordSchema = z.object({
  email: z.string().trim().min(1, 'Email wajib diisi.').email('Format email tidak valid.'),
});

/**
 * The new password, twice.
 *
 * Same bounds as registration — 72 is bcrypt's own ceiling, and a password
 * silently truncated at sign-up would stop matching the one typed here.
 */
export const resetPasswordSchema = z
  .object({
    password: z
      .string()
      .min(8, 'Kata sandi minimal 8 karakter.')
      .max(72, 'Kata sandi maksimal 72 karakter.'),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Konfirmasi kata sandi tidak cocok.',
    path: ['confirmPassword'],
  });

/**
 * Changing your own password while signed in.
 *
 * The current password is required even though Supabase does not ask for it.
 * A session alone is a weak claim to ownership — an unlocked laptop, a shared
 * machine, a borrowed phone — and a password change is the one action that
 * locks the real owner out permanently. Knowing the old password is what
 * separates "the account holder" from "whoever is sitting here".
 */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Kata sandi saat ini wajib diisi.'),
    password: z
      .string()
      .min(8, 'Kata sandi baru minimal 8 karakter.')
      .max(72, 'Kata sandi baru maksimal 72 karakter.'),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Konfirmasi kata sandi tidak cocok.',
    path: ['confirmPassword'],
  })
  // Saving the same password is almost always a mistyped form, and reporting
  // success would tell the user something changed when nothing did.
  .refine((v) => v.password !== v.currentPassword, {
    message: 'Kata sandi baru harus berbeda dari kata sandi saat ini.',
    path: ['password'],
  });

export type ChangePasswordValues = z.output<typeof changePasswordSchema>;

export type LoginValues = z.output<typeof loginSchema>;
export type RegisterValues = z.output<typeof registerSchema>;
export type ForgotPasswordValues = z.output<typeof forgotPasswordSchema>;
export type ResetPasswordValues = z.output<typeof resetPasswordSchema>;
