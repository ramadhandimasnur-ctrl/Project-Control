// Must precede every other import: the database module opens its pool during
// module evaluation and needs the environment already loaded.
import './load-env';

import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { users } from '@/db/schema';
import { readWorkbook } from '@/lib/import/xlsx';
import { importWorkbook, type WorkbookImportReport } from '@/services/import-workbook';

/**
 * Imports a PROJECT_CONTROL workbook.
 *
 *   npm run db:import:wb -- "<file.xlsm>" --email=you@example.com
 *   npm run db:import:wb -- "<file.xlsm>" --email=you@example.com --apply
 *
 * Reads only, unless --apply is given. The dry run performs the whole import
 * inside a transaction and rolls it back, so the counts it prints are what
 * actually happened rather than a prediction.
 */

function flag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = process.argv.find((a) => a.startsWith(prefix));
  return match?.slice(prefix.length);
}

function printReport(report: WorkbookImportReport): void {
  const label = report.dryRun ? 'UJI COBA (tidak ada yang disimpan)' : 'DITERAPKAN';
  console.log(`\n=== ${label} · batch ${report.batch} ===\n`);

  const pad = (s: string | number, n: number) => String(s).padStart(n);
  console.log(
    `  ${'Tabel'.padEnd(22)} ${pad('dibaca', 7)} ${pad('baru', 7)} ${pad('diperbarui', 11)} ${pad('dilewati', 9)} ${pad('dihapus', 8)}`,
  );

  for (const step of report.steps) {
    console.log(
      `  ${step.label.padEnd(22)} ${pad(step.read, 7)} ${pad(step.created, 7)} ${pad(step.updated, 11)} ${pad(step.skipped, 9)} ${pad(step.deleted, 8)}`,
    );
  }

  console.log(
    `  ${'JUMLAH'.padEnd(22)} ${pad('', 7)} ${pad(report.totals.created, 7)} ${pad(report.totals.updated, 11)} ${pad(report.totals.skipped, 9)}`,
  );
  console.log(
    '\nKolom "dihapus" adalah baris yang workbook sendiri tandai terhapus, jadi tidak dibaca.',
  );

  const issues = report.steps.flatMap((step) =>
    step.issues.map((issue) => `${step.label}: ${issue}`),
  );

  if (issues.length > 0) {
    console.log(`\nCatatan (${issues.length}):`);
    for (const issue of issues) console.log(`  - ${issue}`);
  }
}

async function main(): Promise<void> {
  const file = process.argv[2];
  const email = flag('email');
  const apply = process.argv.includes('--apply');
  const source = flag('source') ?? 'PROJECT_CONTROL';

  if (!file || !email) {
    console.error(
      'Pemakaian:\n' +
        '  npm run db:import:wb -- "<file.xlsm>" --email=admin@contoh.com [--apply] [--source=NAMA]\n\n' +
        'Tanpa --apply, seluruh impor dijalankan lalu dibatalkan, dan angkanya tetap nyata.',
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

  const report = await importWorkbook(
    {
      id: actor.id,
      email: actor.email,
      fullName: actor.fullName,
      orgId: actor.orgId,
      globalRole: actor.globalRole,
    },
    workbook,
    { source, dryRun: !apply },
  );

  printReport(report);

  if (!apply) {
    console.log('\nTambahkan --apply untuk menyimpan.');
  }

  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
