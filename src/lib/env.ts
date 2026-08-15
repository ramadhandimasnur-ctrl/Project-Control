import { z } from 'zod';

/**
 * Environment access is validated once, lazily, and reported in Indonesian —
 * a missing connection string should tell the operator what to fix, not throw
 * `undefined is not a string` three layers deep.
 */

/**
 * A variable that is present but empty (`FOO=""` in a template .env) means
 * "not configured", not "configured as the empty string".
 */
const optional = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().min(1).optional(),
);

const serverSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL belum diisi'),
  DIRECT_URL: optional,
  SUPABASE_SERVICE_ROLE_KEY: optional,
  APP_TIMEZONE: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().min(1).default('Asia/Jakarta'),
  ),
});

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url('NEXT_PUBLIC_SUPABASE_URL harus berupa URL yang valid'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, 'NEXT_PUBLIC_SUPABASE_ANON_KEY belum diisi'),
});

export type ServerEnv = z.infer<typeof serverSchema>;
export type PublicEnv = z.infer<typeof publicSchema>;

function describe(issues: z.core.$ZodIssue[]): string {
  return issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
}

let cachedServerEnv: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (cachedServerEnv) return cachedServerEnv;

  const parsed = serverSchema.safeParse({
    DATABASE_URL: process.env.DATABASE_URL,
    DIRECT_URL: process.env.DIRECT_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    APP_TIMEZONE: process.env.APP_TIMEZONE,
  });

  if (!parsed.success) {
    throw new Error(
      `Konfigurasi environment server belum lengkap:\n${describe(parsed.error.issues)}\n` +
        'Salin .env.example menjadi .env.local lalu isi nilainya.',
    );
  }

  cachedServerEnv = parsed.data;
  return cachedServerEnv;
}

/**
 * Read as literal `process.env.X` expressions so the Next.js bundler can
 * statically inline them into the client bundle.
 */
export function publicEnv(): PublicEnv {
  const parsed = publicSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });

  if (!parsed.success) {
    throw new Error(
      `Konfigurasi Supabase belum lengkap:\n${describe(parsed.error.issues)}\n` +
        'Isi NEXT_PUBLIC_SUPABASE_URL dan NEXT_PUBLIC_SUPABASE_ANON_KEY di .env.local.',
    );
  }

  return parsed.data;
}

export const APP_TIMEZONE = 'Asia/Jakarta';
