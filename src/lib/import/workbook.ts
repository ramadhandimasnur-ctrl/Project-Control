import type ExcelJS from 'exceljs';

/**
 * Reads the workbook's `_DB_*` sheets as records keyed by column name.
 *
 * By header name rather than by column letter, deliberately. The workbook is
 * edited by hand between exports and a column inserted in the middle is
 * ordinary; positional reading would keep working and silently put addresses
 * into the phone field. A name that disappears is an error anyone can act on.
 *
 * Everything comes back as a string or null. The workbook stores dates as
 * serial numbers, money as floats and ids as text, and converting each one at
 * the point it is understood is safer than guessing here.
 */

export type SheetRecord = {
  /** 1-based row number in the sheet, for error messages a human can follow. */
  rowNumber: number;
  get(column: string): string | null;
  has(column: string): boolean;
};

export type SheetReadIssue = { sheet: string; message: string };

/** Excel's day zero, in UTC. Serial 1 is 1 January 1900 in its reckoning. */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

/**
 * Turns an Excel serial date into an ISO day.
 *
 * Built in UTC throughout: a serial converted through local time crosses a
 * daylight-saving boundary an hour short and lands a day early, which on a
 * progress entry moves work into the wrong week.
 */
export function excelSerialToDay(value: string | number | null): string | null {
  if (value === null || value === '') return null;

  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    // Already a date string, e.g. when the cell was formatted as text.
    const text = String(value).trim();
    return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
  }

  // Whole days only; the fractional part is a time of day the app has no use for.
  return new Date(EXCEL_EPOCH_MS + Math.floor(n) * 86_400_000).toISOString().slice(0, 10);
}

/** A number the database will accept, or null when the cell said nothing. */
export function decimalOrNull(value: string | null): string | null {
  if (value === null) return null;
  const text = value.trim();
  if (text === '') return null;

  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  /*
   * Fixed rather than raw, because the workbook stores coefficients as floats
   * and 0,013 arrives as 1.2999999999999999E-2. Six places is what the widest
   * column here holds, and trailing zeros are trimmed by the database.
   */
  return n.toFixed(6);
}

export function textOrNull(value: string | null): string | null {
  if (value === null) return null;
  const text = value.trim();
  return text === '' ? null : text;
}

/** Workbook rows carry a soft-delete flag; a deleted row is not a row. */
export function isLiveRow(row: SheetRecord): boolean {
  const status = textOrNull(row.get('RowStatus'));
  return status === null || status.toUpperCase() === 'ACTIVE';
}

function cellText(cell: ExcelJS.Cell): string | null {
  const v = cell.value;
  if (v === null || v === undefined) return null;

  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (v instanceof Date) return v.toISOString().slice(0, 10);

  if (typeof v === 'object') {
    if ('result' in v) {
      const result = (v as ExcelJS.CellFormulaValue).result;
      if (result === null || result === undefined) return null;
      if (result instanceof Date) return result.toISOString().slice(0, 10);
      if (typeof result === 'object') return null;
      return String(result);
    }
    if ('richText' in v) {
      return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join('');
    }
    if ('text' in v) return String((v as ExcelJS.CellHyperlinkValue).text);
  }

  return null;
}

/**
 * Reads one `_DB_*` sheet.
 *
 * The header is row 1 in every table the workbook keeps, and a sheet whose
 * header row is missing is reported rather than read as data — a header read
 * as a record would import a project called "ProjectID".
 */
export function readTable(
  workbook: ExcelJS.Workbook,
  sheetName: string,
): { rows: SheetRecord[]; issues: SheetReadIssue[] } {
  const sheet = workbook.getWorksheet(sheetName);
  if (!sheet) {
    return { rows: [], issues: [{ sheet: sheetName, message: 'Lembar tidak ada di berkas ini.' }] };
  }

  const header = sheet.getRow(1);
  const columnOf = new Map<string, number>();

  header.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
    const name = cellText(cell)?.trim();
    if (name !== undefined && name !== null && name !== '') columnOf.set(name, columnNumber);
  });

  if (columnOf.size === 0) {
    return {
      rows: [],
      issues: [{ sheet: sheetName, message: 'Baris judul kolom kosong; lembar dilewati.' }],
    };
  }

  const rows: SheetRecord[] = [];

  for (let r = 2; r <= sheet.rowCount; r += 1) {
    const row = sheet.getRow(r);
    const record: SheetRecord = {
      rowNumber: r,
      get: (column: string) => {
        const index = columnOf.get(column);
        return index === undefined ? null : cellText(row.getCell(index));
      },
      has: (column: string) => columnOf.has(column),
    };

    // A row where every cell is empty is spacing, not data.
    const empty = [...columnOf.values()].every((index) => cellText(row.getCell(index)) === null);
    if (!empty) rows.push(record);
  }

  return { rows, issues: [] };
}
