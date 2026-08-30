import { type SheetRow } from './utba';

/**
 * Reads a published AHSP library out of the two tables the Excel workbook
 * keeps it in.
 *
 * Pure, like `parseUtba`: the rules live here and are tested without a
 * workbook, and `xlsx.ts` is the only file that knows what a spreadsheet is.
 */

export type AhspLibraryRole = 'LABOR' | 'MATERIAL' | 'EQUIPMENT' | 'SUBCON' | 'PACKAGE';

export type LibraryEntry = {
  sourceKey: string;
  code: string;
  name: string;
  unitCode: string;
  sourceName: string | null;
  sourceYear: number | null;
  sourceDocument: string | null;
  sourceSheet: string | null;
  sourceRow: number | null;
  sourceUrl: string | null;
  items: LibraryItem[];
};

export type LibraryItem = {
  role: AhspLibraryRole;
  resourceCode: string | null;
  resourceName: string;
  unitCode: string;
  coef: string;
  sortOrder: number;
  notes: string | null;
};

export type LibraryParseResult = {
  entries: LibraryEntry[];
  issues: { where: string; message: string }[];
};

/*
 * The source names its sections in Indonesian. `LAIN` is the source's own
 * catch-all — overheads, profit lines, anything that is neither people, stuff
 * nor machines — and lands on PACKAGE because that is this application's
 * catch-all too. Mapping it to SUBCON would assert a subcontractor that the
 * standard never mentions.
 */
const ROLE_BY_CATEGORY: Record<string, AhspLibraryRole> = {
  TENAGA: 'LABOR',
  UPAH: 'LABOR',
  MATERIAL: 'MATERIAL',
  BAHAN: 'MATERIAL',
  ALAT: 'EQUIPMENT',
  PERALATAN: 'EQUIPMENT',
  SUBKON: 'SUBCON',
  LAIN: 'PACKAGE',
};

const text = (value: string | number | null | undefined): string | null => {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
};

const whole = (value: string | number | null | undefined): number | null => {
  const s = text(value);
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

/**
 * Coefficients arrive as floats, so `0.013` reaches us as
 * `1.2999999999999999E-2`. Fixing the scale here rather than at the database
 * keeps the noise out of the stored value, and six places is what the column
 * holds anyway.
 */
function coefficient(value: string | number | null | undefined): string | null {
  const s = text(value);
  if (s === null) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return n.toFixed(6);
}

/** Rows the workbook has soft-deleted are not rows. */
const isLive = (row: SheetRow, column: string): boolean => {
  const status = text(row.get(column));
  return status === null || status.toUpperCase() === 'ACTIVE';
};

export function parseAhspLibrary(
  entryRows: Iterable<SheetRow>,
  itemRows: Iterable<SheetRow>,
): LibraryParseResult {
  const issues: LibraryParseResult['issues'] = [];
  const byKey = new Map<string, LibraryEntry>();

  for (const row of entryRows) {
    const key = text(row.get('A'));
    const code = text(row.get('B'));
    const name = text(row.get('C'));
    if (key === null || code === null || name === null) continue;
    if (!isLive(row, 'R')) continue;

    if (byKey.has(key)) {
      issues.push({ where: `Pustaka baris ${row.rowNumber}`, message: `Id ${key} muncul dua kali.` });
      continue;
    }

    byKey.set(key, {
      sourceKey: key,
      code,
      name,
      unitCode: text(row.get('D')) ?? '-',
      sourceName: text(row.get('E')),
      sourceYear: whole(row.get('F')),
      sourceDocument: text(row.get('G')),
      sourceSheet: text(row.get('I')),
      sourceRow: whole(row.get('J')),
      sourceUrl: text(row.get('K')),
      items: [],
    });
  }

  for (const row of itemRows) {
    const parentKey = text(row.get('B'));
    if (parentKey === null) continue;
    if (!isLive(row, 'P')) continue;

    const parent = byKey.get(parentKey);
    if (!parent) {
      issues.push({
        where: `Rincian baris ${row.rowNumber}`,
        message: `Analisa ${parentKey} tidak ada di tabel pustaka.`,
      });
      continue;
    }

    const resourceName = text(row.get('D'));
    if (resourceName === null) continue;

    const category = (text(row.get('E')) ?? '').toUpperCase();
    const role = ROLE_BY_CATEGORY[category];
    if (role === undefined) {
      issues.push({
        where: `Rincian baris ${row.rowNumber}`,
        message: `Kategori "${category}" tidak dikenal pada ${parent.code}.`,
      });
      continue;
    }

    const coef = coefficient(row.get('G'));
    if (coef === null) {
      issues.push({
        where: `Rincian baris ${row.rowNumber}`,
        message: `Koefisien tidak terbaca pada ${parent.code} — ${resourceName}.`,
      });
      continue;
    }

    parent.items.push({
      role,
      // Most lines name their resource without coding it: 590 of 16.136 in the
      // source. Absent is recorded as absent rather than invented, and the
      // matching problem is dealt with when an entry is applied.
      resourceCode: text(row.get('C')),
      resourceName,
      unitCode: text(row.get('F')) ?? '-',
      coef,
      sortOrder: whole(row.get('H')) ?? 0,
      notes: text(row.get('K')),
    });
  }

  const entries = [...byKey.values()];
  for (const entry of entries) {
    entry.items.sort((a, b) => a.sortOrder - b.sortOrder);
    if (entry.items.length === 0) {
      issues.push({ where: entry.code, message: 'Analisa tanpa satu pun baris rincian.' });
    }
  }

  return { entries: entries.filter((e) => e.items.length > 0), issues };
}
