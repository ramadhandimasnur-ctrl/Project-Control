import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ path: '.env', quiet: true });

/**
 * Sends one notification through the real transport.
 *
 * Deliberately calls the application's own module rather than re-implementing
 * the request: a script with its own copy of the fetch would prove that Resend
 * works, not that this application talks to it correctly.
 */
async function main(): Promise<void> {
  const { emailIsConfigured, notifyAddress, sendAdminEmail } = await import('../src/lib/notify/email');

  console.log('Terkonfigurasi :', emailIsConfigured());
  console.log('Tujuan         :', notifyAddress());
  console.log('Pengirim       :', process.env.NOTIFY_EMAIL_FROM);

  if (!emailIsConfigured()) {
    console.error('Belum lengkap — tidak ada yang dikirim.');
    // Set rather than exit: forcing the process down here trips a libuv
    // assertion on Windows while the fetch agent is still closing.
    process.exitCode = 1;
    return;
  }

  const result = await sendAdminEmail({
    subject: 'Uji notifikasi Project Control',
    text: [
      'Ini email uji dari Project Control.',
      '',
      'Bila Anda menerimanya, notifikasi pendaftaran baru akan sampai ke alamat ini.',
      'Isi sebenarnya nanti memuat nama, username, dan email pendaftar.',
    ].join('\n'),
  });

  console.log('Hasil          :', JSON.stringify(result));
  if (!result.sent) process.exitCode = 1;
}

await main();
