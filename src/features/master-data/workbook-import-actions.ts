'use server';

import { revalidatePath } from 'next/cache';

import { toUserMessage } from '@/lib/errors';
import { importWorkbook, type WorkbookImportReport } from '@/services/import-workbook';
import { requireSessionUser } from '@/services/session';

export type WorkbookImportActionResult =
  | { ok: true; report: WorkbookImportReport }
  | { ok: false; message: string; hint?: string };

/** The workbook is a few megabytes of XML in a zip; this is generous but finite. */
const MAX_BYTES = 15 * 1024 * 1024;

/**
 * Reads an uploaded PROJECT_CONTROL workbook and either reports what an import
 * would do, or performs it.
 *
 * The file is uploaded again for the second step rather than cached between
 * them. Holding a parsed workbook in server memory between two requests would
 * need somewhere to put it and something to expire it, and re-reading a few
 * megabytes costs less than either — the same trade the UTBA import makes.
 */
export async function importWorkbookFromUploadAction(
  formData: FormData,
): Promise<WorkbookImportActionResult> {
  const file = formData.get('file');
  const apply = formData.get('apply') === 'true';
  const source = String(formData.get('source') ?? '').trim() || 'PROJECT_CONTROL';

  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: 'Pilih berkas workbook terlebih dahulu.' };
  }

  if (file.size > MAX_BYTES) {
    return {
      ok: false,
      message: `Berkas terlalu besar (${(file.size / 1024 / 1024).toFixed(1)} MB).`,
      hint:
        `Batasnya ${MAX_BYTES / 1024 / 1024} MB. Untuk berkas yang lebih besar, jalankan impor ` +
        'dari komputer dengan perintah npm run db:import:wb.',
    };
  }

  if (!/\.xls[xm]$/i.test(file.name)) {
    return {
      ok: false,
      message: 'Format berkas harus .xlsm atau .xlsx.',
      hint: 'Berkas PROJECT_CONTROL biasanya berekstensi .xlsm karena memuat makro.',
    };
  }

  try {
    const user = await requireSessionUser();

    // ExcelJS is loaded here rather than at module scope so it stays out of the
    // bundle of every page that merely links to this one.
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());

    /*
     * One named sheet is enough to tell a PROJECT_CONTROL workbook from any
     * other spreadsheet. Without this check a wrong file imports as a long
     * list of empty sheets and reports a successful import of nothing, which
     * reads as "the data was already there".
     */
    if (!workbook.getWorksheet('_DB_PROJECT')) {
      return {
        ok: false,
        message: 'Berkas ini bukan workbook PROJECT_CONTROL.',
        hint: 'Lembar _DB_PROJECT tidak ditemukan. Pastikan yang diunggah adalah berkas induknya, bukan hasil ekspor.',
      };
    }

    const report = await importWorkbook(user, workbook, { source, dryRun: !apply });

    if (apply) {
      revalidatePath('/projects');
      revalidatePath('/master-data/resources');
      revalidatePath('/master-data/units');
      revalidatePath('/master-data/suppliers');
      revalidatePath('/master-data/foremen');
    }

    return { ok: true, report };
  } catch (error) {
    const { message, hint } = toUserMessage(error);
    return hint === undefined ? { ok: false, message } : { ok: false, message, hint };
  }
}
