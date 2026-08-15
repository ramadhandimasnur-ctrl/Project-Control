'use server';

import { revalidatePath } from 'next/cache';

import { toUserMessage } from '@/lib/errors';
import { parseUtba } from '@/lib/import/utba';
import { requireSheet, worksheetRows } from '@/lib/import/xlsx';
import { importUtba, type ImportReport } from '@/services/import-utba';
import { requireSessionUser } from '@/services/session';

export type ImportActionResult =
  | { ok: true; report: ImportReport }
  | { ok: false; message: string; hint?: string };

/** Excel refuses to be small; 3–4 MB is an ordinary workbook here. */
const MAX_BYTES = 15 * 1024 * 1024;

/**
 * Reads an uploaded workbook and either reports what an import would do, or
 * performs it.
 *
 * The file is sent again for the second step rather than cached between them.
 * Holding a parsed workbook in server memory between two requests would need
 * somewhere to put it and something to expire it, and re-reading a few
 * megabytes costs less than either.
 */
export async function importUtbaFromUploadAction(
  formData: FormData,
): Promise<ImportActionResult> {
  const file = formData.get('file');
  const apply = formData.get('apply') === 'true';
  const priceTypeArg = String(formData.get('priceType') ?? 'RAP');
  const onDate = String(formData.get('effectiveFrom') ?? '').trim();

  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: 'Pilih berkas Excel terlebih dahulu.' };
  }

  if (file.size > MAX_BYTES) {
    return {
      ok: false,
      message: `Berkas terlalu besar (${(file.size / 1024 / 1024).toFixed(1)} MB).`,
      hint: `Batasnya ${MAX_BYTES / 1024 / 1024} MB. Hapus sheet yang tidak diperlukan lalu simpan ulang.`,
    };
  }

  if (!/\.xlsx$/i.test(file.name)) {
    return {
      ok: false,
      message: 'Format berkas harus .xlsx.',
      hint: 'Buka di Excel lalu simpan sebagai "Excel Workbook (.xlsx)".',
    };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(onDate)) {
    return { ok: false, message: 'Tanggal berlaku harga tidak valid.' };
  }

  const priceTypes =
    priceTypeArg === 'BOTH' ? (['RAB', 'RAP'] as const) : priceTypeArg === 'RAB' ? (['RAB'] as const) : (['RAP'] as const);

  try {
    const user = await requireSessionUser();

    // ExcelJS is loaded here rather than at module scope so it stays out of
    // the bundle for every page that merely links to this one.
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());

    const sheet = requireSheet(workbook, 'UTBA');
    const parsed = parseUtba(worksheetRows(sheet));

    if (parsed.resources.length === 0) {
      return {
        ok: false,
        message: 'Tidak ada baris yang dapat dibaca dari sheet UTBA.',
        hint: 'Pastikan sheet memuat judul blok (TENAGA, MATERIAL, …) dan baris berkode di bawahnya.',
      };
    }

    const report = await importUtba(user, parsed, {
      onDate,
      priceTypes: [...priceTypes],
      dryRun: !apply,
    });

    if (apply) {
      revalidatePath('/master-data/resources');
      revalidatePath('/master-data/units');
      revalidatePath('/master-data/categories');
    }

    return { ok: true, report };
  } catch (error) {
    const { message, hint } = toUserMessage(error);
    return hint === undefined ? { ok: false, message } : { ok: false, message, hint };
  }
}
