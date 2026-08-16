// Must precede every other import: the database module opens its pool during
// module evaluation and needs the environment already loaded.
import './load-env';

import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { organizations, users } from '@/db/schema';
import { type PriceType } from '@/lib/calc/price';
import { todayIso } from '@/lib/date';
import { parseUtba, type UtbaParseResult } from '@/lib/import/utba';
import { readWorkbook, requireSheet, worksheetRows } from '@/lib/import/xlsx';
import { importUtba, type ImportReport } from '@/services/import-utba';

/**
 * Imports the UTBA sheet of a source workbook into the resource catalogue.
 *
 * Reads only, unless --apply is given. The dry run performs the whole import
 * inside a transaction and rolls it back, so the counts it reports are what
 * actually happened rather than a prediction.
 *
 *   npm run db:import:utba -- "<file.xlsx>" --email=ramadhandimasnur@gmail.com
 *   npm run db:import:utba -- "<file.xlsx>" --email=ramadhandimasnur@gmail.com --apply
 */

function flag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = process.argv.find((a) => a.startsWith(prefix));
  return match?.slice(prefix.length);
}

function printReport(report: ImportReport, parsed: UtbaParseResult): void {
  const label = report.dryRun ? 'UJI COBA (tidak ada yang disimpan)' : 'DITERAPKAN';
  console.log(`\n=== ${label} ===`);
  console.log(`  Satuan     : ${report.units.created} dibuat, ${report.units.existing} sudah ada`);
  console.log(
    `  Kategori   : ${report.categories.created} dibuat, ${report.categories.existing} sudah ada`,
  );
  console.log(
    `  Sumber daya: ${report.resources.created} dibuat, ${report.resources.updated} diperbarui, ${report.resources.unchanged} tidak berubah`,
  );
  console.log(
    `  Harga      : ${report.prices.created} dibuat, ${report.prices.superseded} diganti, ${report.prices.unchanged} tidak berubah`,
  );

  const errors = report.issues.filter((i) => i.severity === 'ERROR');
  const warnings = report.issues.filter((i) => i.severity === 'WARNING');
  console.log(`  Ditolak    : ${errors.length}`);
  console.log(`  Peringatan : ${warnings.length}`);

  for (const issue of errors.slice(0, 20)) {
    console.log(`    baris ${issue.rowNumber} [${issue.code ?? '-'}] ${issue.message}`);
  }
  for (const issue of warnings.slice(0, 20)) {
    console.log(`    baris ${issue.rowNumber} [${issue.code ?? '-'}] ${issue.message}`);
  }

  const total = parsed.resources.length;
  const handled = report.resources.created + report.resources.updated + report.resources.unchanged;
  if (handled !== total) {
    console.log(`\n  CATATAN: ${total - handled} baris terbaca tetapi tidak tersimpan.`);
  }
}

async function main(): Promise<void> {
  const filePath = process.argv[2];
  const email = flag('email');

  if (!filePath || filePath.startsWith('--') || !email) {
    console.error(
      'Penggunaan:\n' +
        '  npm run db:import:utba -- "<file.xlsx>" --email=<email admin> [pilihan]\n\n' +
        'Pilihan:\n' +
        '  --apply            Simpan ke database. Tanpa ini hanya uji coba.\n' +
        '  --date=YYYY-MM-DD  Tanggal berlaku harga (default: hari ini).\n' +
        '  --price=RAP|RAB|BOTH  Kolom harga tujuan (default: RAP).',
    );
    process.exitCode = 1;
    return;
  }

  const priceArg = (flag('price') ?? 'RAP').toUpperCase();
  const priceTypes: PriceType[] =
    priceArg === 'BOTH' ? ['RAB', 'RAP'] : priceArg === 'RAB' ? ['RAB'] : ['RAP'];
  const onDate = flag('date') ?? todayIso();
  const apply = process.argv.includes('--apply');

  const [actor] = await db
    .select({
      id: users.id,
      orgId: users.orgId,
      email: users.email,
      fullName: users.fullName,
      globalRole: users.globalRole,
      orgName: organizations.name,
    })
    .from(users)
    .innerJoin(organizations, eq(organizations.id, users.orgId))
    .where(eq(users.email, email))
    .limit(1);

  if (!actor) {
    console.error(`Pengguna "${email}" tidak ditemukan.`);
    process.exitCode = 1;
    return;
  }

  console.log(`Membaca ${filePath} …`);
  const workbook = await readWorkbook(filePath);
  const parsed = parseUtba(worksheetRows(requireSheet(workbook, 'UTBA')));

  console.log(`  ${parsed.resources.length} sumber daya, ${parsed.categories.length} kategori, ${parsed.units.length} satuan`);
  console.log('');
  console.log(`Organisasi tujuan : ${actor.orgName}`);
  console.log(`Dijalankan sebagai: ${actor.fullName} <${actor.email}> (${actor.globalRole})`);
  console.log(`Harga ditulis ke  : ${priceTypes.join(' dan ')}, berlaku sejak ${onDate}`);

  const report = await importUtba(
    {
      id: actor.id,
      orgId: actor.orgId,
      email: actor.email,
      fullName: actor.fullName,
      globalRole: actor.globalRole,
    },
    parsed,
    { onDate, priceTypes, dryRun: !apply },
  );

  printReport(report, parsed);

  if (!apply) {
    console.log('\nJalankan ulang dengan --apply untuk menyimpan.');
  }
}

main()
  .catch((error: unknown) => {
    console.error('\nImpor gagal.');
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    void (async () => {
      const { sqlClient } = await import('@/db');
      await sqlClient.end({ timeout: 5 });
    })();
  });
