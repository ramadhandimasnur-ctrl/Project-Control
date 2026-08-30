// Must precede every other import: the database module opens its pool during
// module evaluation and needs the environment already loaded.
import './load-env';

import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { users } from '@/db/schema';
import { parseAhspLibrary } from '@/lib/import/ahsp-library';
import { readWorkbook, requireSheet, worksheetRows } from '@/lib/import/xlsx';
import { importAhspLibrary } from '@/services/ahsp-library';

/**
 * Imports a published AHSP library out of the Excel workbook that holds it.
 *
 * The source is the two normalised sheets the workbook keeps the library in —
 * `_DB_AHSPLIBRARY` and `_DB_AHSPLIBDETAIL` — rather than the original
 * publication. The publication is one sheet per chapter with merged headings
 * and example prices mixed into the coefficients; the workbook has already
 * done the work of turning that into rows, and redoing it here would be a
 * second parser to keep in step with the first.
 *
 *   npm run db:import:ahsp -- "<file.xlsm>" --email=you@example.com
 *   npm run db:import:ahsp -- "<file.xlsm>" --email=you@example.com --apply
 *
 * Reads only, unless --apply is given.
 */

const ENTRY_SHEET = '_DB_AHSPLIBRARY';
const ITEM_SHEET = '_DB_AHSPLIBDETAIL';

function flag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = process.argv.find((a) => a.startsWith(prefix));
  return match?.slice(prefix.length);
}

async function main(): Promise<void> {
  const file = process.argv[2];
  const email = flag('email');
  const apply = process.argv.includes('--apply');

  if (!file || !email) {
    console.error(
      'Pemakaian:\n' +
        '  npm run db:import:ahsp -- "<file.xlsm>" --email=admin@contoh.com [--apply]\n\n' +
        'Tanpa --apply, isinya hanya dibaca dan dilaporkan.',
    );
    process.exit(1);
  }

  const [actor] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!actor) {
    console.error(`Pengguna ${email} tidak ditemukan.`);
    process.exit(1);
  }

  console.log(`Membaca ${file} …`);
  const workbook = await readWorkbook(file);
  const parsed = parseAhspLibrary(
    // Row 1 is the header in both sheets.
    worksheetRows(requireSheet(workbook, ENTRY_SHEET), 2),
    worksheetRows(requireSheet(workbook, ITEM_SHEET), 2),
  );

  const lineCount = parsed.entries.reduce((n, e) => n + e.items.length, 0);
  console.log(`\nTerbaca: ${parsed.entries.length} analisa, ${lineCount} baris rincian.`);

  if (parsed.issues.length > 0) {
    console.log(`\nCatatan (${parsed.issues.length}):`);
    for (const issue of parsed.issues.slice(0, 20)) {
      console.log(`  - ${issue.where}: ${issue.message}`);
    }
    if (parsed.issues.length > 20) {
      console.log(`  … dan ${parsed.issues.length - 20} lainnya.`);
    }
  }

  if (!apply) {
    console.log('\nUJI COBA — tidak ada yang disimpan. Tambahkan --apply untuk menyimpan.');
    process.exit(0);
  }

  const batch = `${new Date().toISOString().slice(0, 19)}Z`;
  console.log(`\nMenyimpan (batch ${batch}) …`);

  const summary = await importAhspLibrary(
    {
      id: actor.id,
      email: actor.email,
      fullName: actor.fullName,
      orgId: actor.orgId,
      globalRole: actor.globalRole,
    },
    parsed.entries,
    batch,
  );

  console.log('\n=== DITERAPKAN ===');
  console.log(`  Analisa baru       : ${summary.entriesCreated}`);
  console.log(`  Analisa diperbarui : ${summary.entriesUpdated}`);
  console.log(`  Baris rincian      : ${summary.itemsWritten}`);
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
