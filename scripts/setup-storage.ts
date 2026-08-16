import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ path: '.env', quiet: true });

/**
 * Creates the bucket site photographs and signatures live in.
 *
 * Private, not public. These are project documents — site conditions, defects,
 * and people's signatures — and a public bucket means anyone holding the URL
 * reads them forever. Access goes through short-lived signed URLs minted by
 * the server for a user who has already passed the project's own access check.
 *
 * Idempotent: safe to run on every deploy.
 */

export const PHOTO_BUCKET = 'project-documents';

/** Server-side ceiling. The browser compresses well below this. */
const MAX_BYTES = 8 * 1024 * 1024;

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    console.error('NEXT_PUBLIC_SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY wajib diisi.');
    process.exitCode = 1;
    return;
  }

  const { createClient } = await import('@supabase/supabase-js');
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: existing } = await admin.storage.getBucket(PHOTO_BUCKET);

  if (existing) {
    console.log(`Bucket "${PHOTO_BUCKET}" sudah ada — memperbarui batasannya.`);
    const { error } = await admin.storage.updateBucket(PHOTO_BUCKET, {
      public: false,
      fileSizeLimit: MAX_BYTES,
      allowedMimeTypes: ALLOWED,
    });
    if (error) throw error;
  } else {
    console.log(`Membuat bucket "${PHOTO_BUCKET}" …`);
    const { error } = await admin.storage.createBucket(PHOTO_BUCKET, {
      public: false,
      fileSizeLimit: MAX_BYTES,
      allowedMimeTypes: ALLOWED,
    });
    if (error) throw error;
  }

  console.log('Selesai.');
  console.log(`  Bucket   : ${PHOTO_BUCKET}`);
  console.log(`  Publik   : tidak — dibaca lewat signed URL`);
  console.log(`  Maksimum : ${(MAX_BYTES / 1024 / 1024).toFixed(0)} MB per berkas`);
  console.log(`  Tipe     : ${ALLOWED.join(', ')}`);
}

await main();
