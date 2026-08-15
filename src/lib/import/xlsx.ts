import ExcelJS from 'exceljs';

import { type SheetRow } from './utba';

/**
 * ExcelJS adapter.
 *
 * The only place in the import path that knows about spreadsheets. `parseUtba`
 * works on the `SheetRow` shape produced here, which is what lets the parsing
 * rules be tested without a workbook.
 */

/** Flattens a cell to the primitive the parser expects. */
function cellValue(cell: ExcelJS.Cell): string | number | null {
  const v = cell.value;
  if (v === null || v === undefined) return null;

  if (typeof v === 'string' || typeof v === 'number') return v;
  if (typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);

  if (typeof v === 'object') {
    // Formula cells: take the cached result. Excel stores it alongside the
    // formula, so a value is available without evaluating anything.
    if ('result' in v) {
      const result = (v as ExcelJS.CellFormulaValue).result;
      if (result === null || result === undefined) return null;
      if (typeof result === 'string' || typeof result === 'number') return result;
      if (result instanceof Date) return result.toISOString().slice(0, 10);
      // An error result (#REF!, #DIV/0!) — surface it so the parser can
      // reject the row by name rather than treating it as empty.
      if (typeof result === 'object' && 'error' in result) return String(result.error);
      return null;
    }
    if ('richText' in v) {
      return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join('');
    }
    if ('error' in v) return String((v as ExcelJS.CellErrorValue).error);
    if ('text' in v) return String((v as ExcelJS.CellHyperlinkValue).text);
  }

  return null;
}

export async function readWorkbook(filePath: string): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  return workbook;
}

export function worksheetRows(worksheet: ExcelJS.Worksheet, startRow = 1): SheetRow[] {
  const rows: SheetRow[] = [];

  for (let r = startRow; r <= worksheet.rowCount; r += 1) {
    const row = worksheet.getRow(r);
    rows.push({
      rowNumber: r,
      get: (column: string) => cellValue(row.getCell(column)),
    });
  }

  return rows;
}

/** Reads one named sheet, with a readable error when it is absent. */
export function requireSheet(workbook: ExcelJS.Workbook, name: string): ExcelJS.Worksheet {
  const sheet = workbook.getWorksheet(name);
  if (!sheet) {
    const available = workbook.worksheets.map((w) => w.name).join(', ');
    throw new Error(
      `Sheet "${name}" tidak ditemukan di file Excel.\n` + `Sheet yang tersedia: ${available}`,
    );
  }
  return sheet;
}
