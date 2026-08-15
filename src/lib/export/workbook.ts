import 'server-only';

import ExcelJS from 'exceljs';

import { NUMBER_FORMATS, cellValue, safeSheetName, type SheetSpec } from './sheets';

/**
 * Turns sheet specifications into an actual .xlsx.
 *
 * The only file-producing part of the export, kept apart from the decisions
 * about what a report contains so those can be tested without opening a binary.
 */
export async function buildWorkbook(sheets: readonly SheetSpec[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Project Control';
  workbook.created = new Date();

  for (const spec of sheets) {
    const sheet = workbook.addWorksheet(safeSheetName(spec.name));

    for (const line of spec.preamble) {
      const row = sheet.addRow([line]);
      row.font = { bold: line === spec.preamble[0] };
    }
    if (spec.preamble.length > 0) sheet.addRow([]);

    const headerRow = sheet.addRow(spec.columns.map((column) => column.header));
    headerRow.font = { bold: true };
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } } };
    });

    for (const row of spec.rows) {
      const values = spec.columns.map((column) => cellValue(row[column.key], column.format));
      const added = sheet.addRow(values);

      spec.columns.forEach((column, index) => {
        const format = NUMBER_FORMATS[column.format];
        if (format) added.getCell(index + 1).numFmt = format;
      });
    }

    spec.columns.forEach((column, index) => {
      sheet.getColumn(index + 1).width = column.width;
    });

    // Freezes the header so a long report stays readable while scrolling.
    sheet.views = [{ state: 'frozen', ySplit: sheet.rowCount - spec.rows.length }];
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
