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

export type LoginValues = z.output<typeof loginSchema>;
export type RegisterValues = z.output<typeof registerSchema>;
