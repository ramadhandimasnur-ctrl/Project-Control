import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Service-role client, for the two things a user's own session cannot do:
 * mint a signed upload URL, and read a private object back.
 *
 * This key bypasses row-level security entirely, so nothing here may be reached
 * from a route that has not already checked the caller's project access. Every
 * caller in `services/documents` does that first, and the module is
 * `server-only` so the key can never reach a browser bundle.
 */

let cached: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY belum diisi; unggahan dokumen tidak dapat dilayani.',
    );
  }

  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

/** Bucket holding site photographs and signatures. Created by scripts/setup-storage.ts. */
export const DOCUMENT_BUCKET = 'project-documents';
