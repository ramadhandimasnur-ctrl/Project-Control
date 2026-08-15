import { createScriptClient, directUrl, hostOf } from './script-client';

/**
 * Drops and recreates the `public` schema. Development only.
 *
 * Requires an explicit --force and prints the target host first, because the
 * same command pointed at the wrong connection string would destroy a real
 * project's data.
 */
async function main(): Promise<void> {
  const url = directUrl();
  const host = hostOf(url);

  if (!process.argv.includes('--force')) {
    console.error(
      `Perintah ini MENGHAPUS SELURUH DATA pada ${host}.\n` +
        'Jalankan ulang dengan --force bila memang itu yang Anda inginkan:\n' +
        '  npm run db:reset -- --force',
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Menghapus schema public pada ${host} …`);
  const client = createScriptClient();
  try {
    await client.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public;').simple();
    console.log('Schema public dibuat ulang. Jalankan `npm run db:setup` lalu `npm run db:seed`.');
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error('Reset gagal.');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
