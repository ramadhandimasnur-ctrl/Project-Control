import { config } from 'dotenv';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';

/**
 * Moves the master account to a new email address.
 *
 * The address lives in two places that must agree: Supabase Auth, which is
 * what sign-in checks, and the application's own `users` row, which is what
 * every screen displays. Changing one and not the other produces an account
 * that signs in under one address and is addressed by another — and the
 * mismatch only shows up when somebody is emailed about their own account.
 *
 * Identity, role and project memberships all hang off the user id, which does
 * not change. Nothing has to be re-granted.
 *
 * Usage: node scripts/move-master-account.mjs <email-lama> <email-baru>
 */

config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });

const [fromEmail, toEmail] = process.argv.slice(2);

if (!fromEmail || !toEmail) {
  console.error('Pemakaian: node scripts/move-master-account.mjs <email-lama> <email-baru>');
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (!supabaseUrl || !serviceKey || !databaseUrl) {
  console.error(
    'NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, dan DATABASE_URL wajib terisi.',
  );
  process.exit(1);
}

const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
const sql = postgres(databaseUrl, { max: 1, prepare: false, ssl: 'require' });

try {
  const { data: list, error: listError } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (listError) throw new Error(listError.message);

  const source = list.users.find((u) => u.email?.toLowerCase() === fromEmail.toLowerCase());
  if (!source) throw new Error(`Akun Supabase Auth dengan email ${fromEmail} tidak ditemukan.`);

  const clash = list.users.find(
    (u) => u.email?.toLowerCase() === toEmail.toLowerCase() && u.id !== source.id,
  );
  if (clash) throw new Error(`Email ${toEmail} sudah dipakai akun lain (${clash.id}).`);

  /*
   * `email_confirm` is set so the address is trusted immediately. Without it
   * Supabase queues a confirmation mail and leaves sign-in on the old address
   * until it is clicked — which is a working account today and a broken one
   * the moment the operator assumes the move is done.
   */
  const { error: updateError } = await admin.auth.admin.updateUserById(source.id, {
    email: toEmail,
    email_confirm: true,
  });
  if (updateError) throw new Error(updateError.message);

  const rows = await sql`
    UPDATE users SET email = ${toEmail}, updated_at = now()
    WHERE id = ${source.id}
    RETURNING full_name, email, global_role, status, is_active
  `;

  if (rows.length === 0) {
    throw new Error(
      `Email Supabase Auth sudah dipindahkan, tetapi baris users untuk ${source.id} tidak ada. ` +
        'Perbaiki manual agar keduanya kembali sejalan.',
    );
  }

  const memberships = await sql`
    SELECT p.name, m.role FROM project_members m
    JOIN projects p ON p.id = m.project_id
    WHERE m.user_id = ${source.id}
    ORDER BY p.name
  `;

  console.log(`Akun master dipindahkan: ${fromEmail} → ${toEmail}`);
  console.table(rows.map((r) => ({ ...r })));
  console.log('Keanggotaan proyek yang tetap melekat:');
  console.table(memberships.map((r) => ({ ...r })));
  console.log('Kata sandi tidak berubah.');
} catch (error) {
  console.error('Gagal:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
