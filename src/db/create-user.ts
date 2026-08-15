// Must precede every other import: the database module opens its pool during
// module evaluation and needs the environment already loaded.
import './load-env';

import { createClient } from '@supabase/supabase-js';
import { eq } from 'drizzle-orm';

import { db, sqlClient } from '@/db';
import { withBypass } from '@/db/context';
import { organizations, users } from '@/db/schema';

/**
 * Provisions a user inside an *existing* organisation.
 *
 * Registration deliberately creates a new organisation for its first account,
 * so it cannot be used to add a colleague to the organisation you already
 * have. Until an invitation flow exists, this is how a second administrator —
 * or any member — is created.
 *
 * The password is never generated here and never passed on the command line,
 * where it would land in the shell history. It is read from the
 * NEW_USER_PASSWORD environment variable, which you set yourself.
 *
 *   npm run db:user -- --email=you@firm.co.id --name="Nama Lengkap" --role=ADMIN
 */

function flag(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

async function main(): Promise<void> {
  const email = flag('email');
  const fullName = flag('name');
  const roleArg = (flag('role') ?? 'MEMBER').toUpperCase();
  const orgName = flag('org');
  const password = process.env.NEW_USER_PASSWORD;

  if (!email || !fullName) {
    console.error(
      'Penggunaan:\n' +
        '  npm run db:user -- --email=<email> --name="<nama lengkap>" [--role=ADMIN|MEMBER] [--org="<nama organisasi>"]\n\n' +
        'Kata sandi dibaca dari variabel NEW_USER_PASSWORD, bukan dari argumen,\n' +
        'agar tidak tersimpan di riwayat shell. Tambahkan sementara di .env.local:\n' +
        '  NEW_USER_PASSWORD="kata sandi pilihan Anda"',
    );
    process.exitCode = 1;
    return;
  }

  if (roleArg !== 'ADMIN' && roleArg !== 'MEMBER') {
    console.error(`Peran "${roleArg}" tidak dikenal. Gunakan ADMIN atau MEMBER.`);
    process.exitCode = 1;
    return;
  }

  if (!password || password.length < 8) {
    console.error(
      'NEW_USER_PASSWORD belum diisi, atau kurang dari 8 karakter.\n' +
        'Tambahkan di .env.local, jalankan perintah ini, lalu hapus lagi barisnya.',
    );
    process.exitCode = 1;
    return;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error(
      'NEXT_PUBLIC_SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY wajib terisi untuk membuat akun.',
    );
    process.exitCode = 1;
    return;
  }

  // --- pick the organisation ------------------------------------------------
  const orgs = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations);

  if (orgs.length === 0) {
    console.error('Belum ada organisasi. Daftar lebih dulu lewat /register.');
    process.exitCode = 1;
    return;
  }

  const org = orgName ? orgs.find((o) => o.name === orgName) : orgs[0];

  if (!org) {
    console.error(
      `Organisasi "${orgName}" tidak ditemukan. Yang tersedia:\n` +
        orgs.map((o) => `  - ${o.name}`).join('\n'),
    );
    process.exitCode = 1;
    return;
  }

  if (!orgName && orgs.length > 1) {
    console.error(
      'Ada lebih dari satu organisasi; sebutkan yang mana dengan --org="<nama>":\n' +
        orgs.map((o) => `  - ${o.name}`).join('\n'),
    );
    process.exitCode = 1;
    return;
  }

  // --- Supabase Auth --------------------------------------------------------
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  let authUserId = created.data.user?.id;
  let reused = false;

  if (!authUserId) {
    // Already registered: reuse the account and reset its password, which is
    // the sane behaviour when someone has forgotten it.
    const existing = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const match = existing.data.users.find((u) => u.email === email);

    if (!match) {
      console.error(
        `Gagal membuat akun Supabase: ${created.error?.message ?? 'penyebab tidak diketahui'}`,
      );
      process.exitCode = 1;
      return;
    }

    authUserId = match.id;
    reused = true;
    const updated = await admin.auth.admin.updateUserById(match.id, { password });
    if (updated.error) {
      console.error(`Gagal memperbarui kata sandi: ${updated.error.message}`);
      process.exitCode = 1;
      return;
    }
  }

  // --- application user row -------------------------------------------------
  await withBypass(async (tx) => {
    const [row] = await tx.select({ id: users.id }).from(users).where(eq(users.id, authUserId)).limit(1);

    if (row) {
      await tx
        .update(users)
        .set({ orgId: org.id, email, fullName, globalRole: roleArg, isActive: true })
        .where(eq(users.id, authUserId));
    } else {
      await tx.insert(users).values({
        id: authUserId,
        orgId: org.id,
        email,
        fullName,
        globalRole: roleArg,
        isActive: true,
      });
    }
  });

  console.log(reused ? 'Akun sudah ada — kata sandi diperbarui.' : 'Akun dibuat.');
  console.log(`  Email      : ${email}`);
  console.log(`  Nama       : ${fullName}`);
  console.log(`  Peran      : ${roleArg}`);
  console.log(`  Organisasi : ${org.name}`);
  console.log('\nHapus kembali NEW_USER_PASSWORD dari .env.local setelah ini.');
}

main()
  .catch((error: unknown) => {
    console.error('Gagal.');
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => void sqlClient.end({ timeout: 5 }));
