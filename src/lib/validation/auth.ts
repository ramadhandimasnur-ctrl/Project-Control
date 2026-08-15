import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().trim().min(1, 'Email wajib diisi.').email('Format email tidak valid.'),
  password: z.string().min(1, 'Kata sandi wajib diisi.'),
});

export const registerSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Nama lengkap wajib diisi.').max(200),
    organizationName: z
      .string()
      .trim()
      .min(2, 'Nama organisasi wajib diisi.')
      .max(200),
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
