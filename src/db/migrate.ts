import { migrate } from 'drizzle-orm/postgres-js/migrator';

import { createScriptClient, createScriptDb, describeDbError, directUrl, hostOf } from './script-client';

async function main(): Promise<void> {
  const url = directUrl();
  console.log(`Menjalankan migrasi pada ${hostOf(url)} …`);

  const client = createScriptClient();
  try {
    await migrate(createScriptDb(client), { migrationsFolder: 'src/db/migrations' });
    console.log('Migrasi selesai.');
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error('Migrasi gagal.');
  console.error(describeDbError(error));
  process.exitCode = 1;
});
