import { parseUtba } from '@/lib/import/utba';
import { readWorkbook, requireSheet, worksheetRows } from '@/lib/import/xlsx';

/**
 * Reads the UTBA sheet of a source workbook and reports what an import would
 * produce. Writing to the database comes next; this pass exists so the file
 * can be inspected before anything is committed to it.
 *
 *   npx tsx src/db/import-utba.ts "<path to .xlsx>"
 */
async function main(): Promise<void> {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Sebutkan lokasi file Excel:\n  npx tsx src/db/import-utba.ts "…/ANALISA RAP.xlsx"');
    process.exitCode = 1;
    return;
  }

  console.log(`Membaca ${filePath} …`);
  const workbook = await readWorkbook(filePath);
  const sheet = requireSheet(workbook, 'UTBA');

  const result = parseUtba(worksheetRows(sheet));

  const errors = result.issues.filter((i) => i.severity === 'ERROR');
  const warnings = result.issues.filter((i) => i.severity === 'WARNING');

  console.log('');
  console.log('=== Ringkasan ===');
  console.log(`  Sumber daya terbaca : ${result.resources.length}`);
  console.log(`  Kategori            : ${result.categories.length}`);
  console.log(`  Satuan              : ${result.units.length}`);
  console.log(`  Baris ditolak       : ${errors.length}`);
  console.log(`  Peringatan          : ${warnings.length}`);

  const byType = new Map<string, number>();
  for (const r of result.resources) byType.set(r.type, (byType.get(r.type) ?? 0) + 1);
  console.log('\n=== Per jenis ===');
  for (const [type, n] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type.padEnd(10)} ${String(n).padStart(4)}`);
  }

  console.log('\n=== Kategori ===');
  for (const c of result.categories) {
    const count = result.resources.filter((r) => r.categoryCode === c.code).length;
    const indent = c.parentCode ? '    ' : '  ';
    console.log(`${indent}${c.name.padEnd(32)} ${c.type.padEnd(9)} ${String(count).padStart(4)}`);
  }

  console.log('\n=== Satuan ===');
  for (const u of result.units) {
    console.log(`  ${u.code.padEnd(10)} ${u.dimension.padEnd(8)} ${String(u.usageCount).padStart(4)}`);
  }

  if (errors.length > 0) {
    console.log('\n=== Baris ditolak ===');
    for (const issue of errors.slice(0, 30)) {
      console.log(`  baris ${issue.rowNumber} [${issue.code ?? '-'}] ${issue.message}`);
    }
    if (errors.length > 30) console.log(`  … dan ${errors.length - 30} lainnya`);
  }

  if (warnings.length > 0) {
    console.log('\n=== Peringatan ===');
    for (const issue of warnings.slice(0, 30)) {
      console.log(`  baris ${issue.rowNumber} [${issue.code ?? '-'}] ${issue.message}`);
    }
    if (warnings.length > 30) console.log(`  … dan ${warnings.length - 30} lainnya`);
  }

  console.log('\n=== Contoh 5 baris pertama ===');
  for (const r of result.resources.slice(0, 5)) {
    console.log(
      `  ${r.code.padEnd(9)} ${r.name.slice(0, 26).padEnd(26)} ${(r.spec ?? '').slice(0, 18).padEnd(18)} ${r.unitCode.padEnd(6)} ${r.price.padStart(12)}  ${r.type}`,
    );
  }
}

main().catch((error: unknown) => {
  console.error('\nPembacaan gagal.');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
