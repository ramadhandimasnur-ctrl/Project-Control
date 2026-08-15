import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { createScriptClient, directUrl, hostOf } from './script-client';

const SQL_DIR = path.join('src', 'db', 'sql');
const VIEWS_FILE = path.join('src', 'db', 'views.sql');

/**
 * Applies the hand-written SQL that Drizzle does not generate: integrity
 * triggers, row-level security, and the reporting views.
 *
 * Every file must be idempotent — this runs on each deploy, after migrations.
 */
async function main(): Promise<void> {
  const url = directUrl();
  console.log(`Menerapkan SQL tambahan pada ${hostOf(url)} …`);

  const entries = (await readdir(SQL_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));

  const files = [...entries.map((f) => path.join(SQL_DIR, f)), VIEWS_FILE];

  const client = createScriptClient();
  try {
    for (const file of files) {
      const content = await readFile(file, 'utf8');
      if (content.trim() === '') continue;
      process.stdout.write(`  ${file} … `);
      // Simple protocol: the files contain DO $$ … $$ blocks that must not be
      // split on semicolons.
      await client.unsafe(content).simple();
      console.log('ok');
    }
    console.log('SQL tambahan selesai diterapkan.');
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.log('');
  console.error('Penerapan SQL tambahan gagal.');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
