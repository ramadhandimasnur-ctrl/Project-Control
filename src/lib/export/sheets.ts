/**
 * Shapes the report data into sheets.
 *
 * Pure: it decides what the columns are, what each cell holds and how it should
 * be formatted, but writes nothing. The workbook writer turns this into a file.
 * Splitting it that way means the part that decides what a report says can be
 * tested without producing a binary and opening it.
 *
 * Numbers stay numbers. Exporting "Rp 1.500.000" as text produces a spreadsheet
 * that cannot sum its own column, which defeats the point of exporting to a
 * spreadsheet at all.
 */

export type CellFormat = 'text' | 'money' | 'percent' | 'ratio' | 'date' | 'integer';

export type SheetColumn = {
  header: string;
  key: string;
  width: number;
  format: CellFormat;
};

export type SheetSpec = {
  name: string;
  /** Lines printed above the table: project, period, when it was produced. */
  preamble: string[];
  columns: SheetColumn[];
  rows: Record<string, string | number | null>[];
};

/** Excel number formats, in the Indonesian convention. */
export const NUMBER_FORMATS: Record<CellFormat, string | undefined> = {
  text: undefined,
  money: '#,##0',
  percent: '0.00%',
  ratio: '0.00',
  date: 'dd/mm/yyyy',
  integer: '#,##0',
};

/**
 * Turns a stored decimal string into what the cell should hold.
 *
 * Percentages are stored as 0..1 fractions and Excel's percent format expects
 * exactly that, so they pass through unscaled — multiplying here would show
 * 5000% where 50% was meant.
 */
export function cellValue(
  raw: string | number | null | undefined,
  format: CellFormat,
): string | number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (format === 'text' || format === 'date') return String(raw);

  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** A sheet name Excel will accept: 31 characters, none of `[]:*?/\`. */
export function safeSheetName(name: string): string {
  const cleaned = name.replace(/[[\]:*?/\\]/g, ' ').trim();
  return (cleaned === '' ? 'Sheet' : cleaned).slice(0, 31);
}

/** File name for a download, without characters a filesystem will refuse. */
export function exportFileName(projectCode: string, report: string, today: string): string {
  const safe = `${projectCode}-${report}-${today}`.replace(/[^A-Za-z0-9._-]+/g, '-');
  return `${safe}.xlsx`;
}

// --- report definitions -----------------------------------------------------

export type CashflowExportInput = {
  preamble: string[];
  flow: {
    label: string;
    opening: string;
    inflow: string;
    outflow: string;
    net: string;
    closing: string;
  }[];
};

export function cashflowSheet(input: CashflowExportInput): SheetSpec {
  return {
    name: 'Arus Kas',
    preamble: input.preamble,
    columns: [
      { header: 'Periode', key: 'label', width: 24, format: 'text' },
      { header: 'Saldo awal', key: 'opening', width: 18, format: 'money' },
      { header: 'Masuk', key: 'inflow', width: 18, format: 'money' },
      { header: 'Keluar', key: 'outflow', width: 18, format: 'money' },
      { header: 'Bersih', key: 'net', width: 18, format: 'money' },
      { header: 'Saldo akhir', key: 'closing', width: 18, format: 'money' },
    ],
    rows: input.flow.map((point) => ({
      label: point.label,
      opening: point.opening,
      inflow: point.inflow,
      outflow: point.outflow,
      net: point.net,
      closing: point.closing,
    })),
  };
}

export type FinanceExportInput = {
  preamble: string[];
  items: {
    code: string;
    name: string;
    unitCode: string;
    volume: string;
    totalRab: string;
    totalRap: string;
    contractValue: string;
    margin: string;
    weight: string;
  }[];
  byCategory: { category: string; amount: string }[];
};

export function financeSheets(input: FinanceExportInput): SheetSpec[] {
  return [
    {
      name: 'RAB vs RAP',
      preamble: input.preamble,
      columns: [
        { header: 'Kode', key: 'code', width: 14, format: 'text' },
        { header: 'Uraian', key: 'name', width: 42, format: 'text' },
        { header: 'Sat', key: 'unitCode', width: 8, format: 'text' },
        { header: 'Volume', key: 'volume', width: 14, format: 'ratio' },
        { header: 'Nilai kontrak', key: 'contractValue', width: 18, format: 'money' },
        { header: 'RAB', key: 'totalRab', width: 18, format: 'money' },
        { header: 'RAP', key: 'totalRap', width: 18, format: 'money' },
        { header: 'Margin', key: 'margin', width: 18, format: 'money' },
        { header: 'Bobot', key: 'weight', width: 12, format: 'percent' },
      ],
      rows: input.items.map((item) => ({ ...item })),
    },
    {
      name: 'Realisasi Biaya',
      preamble: input.preamble,
      columns: [
        { header: 'Kategori', key: 'category', width: 28, format: 'text' },
        { header: 'Realisasi', key: 'amount', width: 20, format: 'money' },
      ],
      rows: input.byCategory.map((row) => ({ ...row })),
    },
  ];
}

export type ProgressExportInput = {
  preamble: string[];
  /** Headings for the three progress columns, worded for the period calendar. */
  columns: { previous: string; current: string; cumulative: string };
  curve: {
    label: string;
    plannedPct: string;
    plannedCumulative: string;
    actualCumulative: string | null;
    deviation: string | null;
  }[];
  items: {
    code: string;
    name: string;
    unitCode: string;
    weight: string;
    /** Weighted against the whole project, so the columns sum. */
    previous: string;
    current: string;
    cumulative: string;
    planned: string;
    deviation: string;
    /** The item's own completion, for readers checking a single line. */
    completedBefore: string;
    pctThisPeriod: string;
    status: string;
  }[];
};

export function progressSheets(input: ProgressExportInput): SheetSpec[] {
  return [
    {
      name: 'Kurva-S',
      preamble: input.preamble,
      columns: [
        { header: 'Periode', key: 'label', width: 24, format: 'text' },
        { header: 'Porsi rencana', key: 'plannedPct', width: 16, format: 'percent' },
        { header: 'Rencana kumulatif', key: 'plannedCumulative', width: 20, format: 'percent' },
        { header: 'Realisasi kumulatif', key: 'actualCumulative', width: 20, format: 'percent' },
        { header: 'Deviasi', key: 'deviation', width: 16, format: 'percent' },
      ],
      rows: input.curve.map((point) => ({ ...point })),
    },
    {
      name: 'Rekap Pekerjaan',
      preamble: input.preamble,
      /*
       * The bobot columns come first because they are the ones that add up:
       * the reader sums them down the page and lands on the project's
       * progress. The item's own percentages follow as a check on any single
       * line, where summing would be meaningless.
       */
      columns: [
        { header: 'Kode', key: 'code', width: 14, format: 'text' },
        { header: 'Uraian', key: 'name', width: 42, format: 'text' },
        { header: 'Sat', key: 'unitCode', width: 8, format: 'text' },
        { header: 'Bobot', key: 'weight', width: 12, format: 'percent' },
        { header: `Bobot ${input.columns.previous}`, key: 'previous', width: 18, format: 'percent' },
        { header: `Bobot ${input.columns.current}`, key: 'current', width: 18, format: 'percent' },
        {
          header: `Bobot ${input.columns.cumulative}`,
          key: 'cumulative',
          width: 20,
          format: 'percent',
        },
        { header: 'Bobot rencana', key: 'planned', width: 18, format: 'percent' },
        { header: 'Deviasi', key: 'deviation', width: 14, format: 'percent' },
        { header: 'Selesai sebelumnya', key: 'completedBefore', width: 20, format: 'percent' },
        { header: 'Periode ini', key: 'pctThisPeriod', width: 16, format: 'percent' },
        { header: 'Status', key: 'status', width: 16, format: 'text' },
      ],
      rows: input.items.map((item) => ({ ...item })),
    },
  ];
}
