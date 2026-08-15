import { Decimal } from '@/lib/calc/decimal';

/**
 * Parser for the UTBA sheet — the master resource list of the source workbook.
 *
 * Pure on purpose: it takes an abstract row reader rather than an ExcelJS
 * worksheet, so the whole of the interesting logic — block detection, type
 * mapping, unit inference, defect reporting — is unit tested without a
 * spreadsheet anywhere in sight. The ExcelJS adapter lives with the importer
 * service.
 *
 * Sheet shape, as found in "ANALISA RAP KOST UNGARAN.xlsx":
 *
 *   row 5          header (KODE | TENAGA/MATERIAL | … | SAT | HARGA | KET)
 *   row 6, 86, …   block headings: a name in column B with no code in A
 *   data rows      A=code  B=name  C,D=specification  E=unit  F=price  G=brand
 *
 * A block heading both classifies the rows beneath it and becomes a resource
 * category.
 */

export type ResourceType = 'LABOR' | 'MATERIAL' | 'EQUIPMENT' | 'SUBCON' | 'PACKAGE' | 'OVERHEAD';

export type UnitDimension =
  | 'LENGTH'
  | 'AREA'
  | 'VOLUME'
  | 'MASS'
  | 'COUNT'
  | 'TIME'
  | 'LUMPSUM';

/** One physical row of the sheet, addressed by column letter. */
export type SheetRow = {
  rowNumber: number;
  get(column: string): string | number | null | undefined;
};

export type UtbaResource = {
  rowNumber: number;
  code: string;
  name: string;
  spec: string | null;
  /** Brand or remark from column G, e.g. "FOCON 7,5". */
  note: string | null;
  unitCode: string;
  /** Money as an exact decimal string, never a float. */
  price: string;
  categoryCode: string;
  categoryName: string;
  type: ResourceType;
};

export type UtbaCategory = {
  code: string;
  name: string;
  type: ResourceType;
  parentCode: string | null;
  rowNumber: number;
};

export type UtbaUnit = {
  code: string;
  dimension: UnitDimension;
  usageCount: number;
};

export type ImportIssue = {
  rowNumber: number;
  code: string | null;
  severity: 'ERROR' | 'WARNING';
  message: string;
};

export type UtbaParseResult = {
  resources: UtbaResource[];
  categories: UtbaCategory[];
  units: UtbaUnit[];
  issues: ImportIssue[];
};

/**
 * Block headings that introduce a resource *type* rather than a category of
 * their own. Everything else inherits the type of the block above it.
 */
const TYPE_HEADINGS: Record<string, ResourceType> = {
  TENAGA: 'LABOR',
  MATERIAL: 'MATERIAL',
  ALAT: 'EQUIPMENT',
  PERALATAN: 'EQUIPMENT',
  SUBKON: 'SUBCON',
  'PAKET PEKERJAAN': 'PACKAGE',
  OPERASIONAL: 'OVERHEAD',
};

/**
 * Unit codes seen in the workbook, mapped to the dimension they measure.
 * Anything unlisted falls back to COUNT and raises a warning, so an unfamiliar
 * unit is visible rather than silently mis-classified — mixing dimensions is
 * how a "50 kg" order becomes "50 m³".
 */
const UNIT_DIMENSIONS: Record<string, UnitDimension> = {
  // Measured dimensions — these are the ones where a wrong guess corrupts
  // quantities, so they are listed explicitly.
  m: 'LENGTH',
  "m'": 'LENGTH',
  m1: 'LENGTH',
  m2: 'AREA',
  m3: 'VOLUME',
  kg: 'MASS',
  ton: 'MASS',
  ls: 'LUMPSUM',
  hr: 'TIME',
  hari: 'TIME',
  mg: 'TIME',
  bln: 'TIME',
  oh: 'TIME',
  jam: 'TIME',

  // Counting units observed in the workbook. Listing them keeps the import log
  // free of two dozen warnings that carry no information; a unit that is
  // genuinely unfamiliar still stands out.
  bh: 'COUNT',
  btg: 'COUNT',
  lbr: 'COUNT',
  roll: 'COUNT',
  dos: 'COUNT',
  doss: 'COUNT',
  pail: 'COUNT',
  zak: 'COUNT',
  sak: 'COUNT',
  unit: 'COUNT',
  titik: 'COUNT',
  psg: 'COUNT',
  tgh: 'COUNT',
  box: 'COUNT',
  budle: 'COUNT',
  bundle: 'COUNT',
  klg: 'COUNT',
  gln: 'COUNT',
  tbg: 'COUNT',
  set: 'COUNT',
  tank: 'COUNT',
  buah: 'COUNT',
};

function normaliseUnit(raw: string): string {
  return raw.trim().toLowerCase();
}

export function unitDimension(unitCode: string): UnitDimension | null {
  return UNIT_DIMENSIONS[normaliseUnit(unitCode)] ?? null;
}

function textOf(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/**
 * Reads a money cell. Accepts the Indonesian conventions found in the sheet
 * (thousands dots, decimal comma) as well as plain numbers, and refuses
 * anything it cannot read exactly rather than guessing a value.
 */
export function parsePrice(value: string | number | null | undefined): Decimal | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? new Decimal(value) : null;
  }

  const raw = value.trim().replace(/^rp\.?\s*/i, '');
  if (raw === '') return null;

  // "1.234.567,89" → "1234567.89"; "1234567.89" is left alone.
  const looksIndonesian = /,\d{1,2}$/.test(raw) || /\.\d{3}(\D|$)/.test(raw);
  const cleaned = looksIndonesian ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '');

  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  try {
    return new Decimal(cleaned);
  } catch {
    return null;
  }
}

/** Turns a block heading into a stable, code-shaped identifier. */
function categoryCodeOf(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .toUpperCase()
    .slice(0, 32);
}

export function parseUtba(rows: Iterable<SheetRow>): UtbaParseResult {
  const resources: UtbaResource[] = [];
  const categories: UtbaCategory[] = [];
  const issues: ImportIssue[] = [];
  const unitUsage = new Map<string, number>();

  const seenCodes = new Map<string, number>();
  const usedCategoryCodes = new Set<string>();

  let currentType: ResourceType | null = null;
  let currentTypeCode: string | null = null;
  let currentCategory: UtbaCategory | null = null;
  let preambleRows = 0;

  for (const row of rows) {
    const code = textOf(row.get('A'));
    const label = textOf(row.get('B'));

    // --- block heading -----------------------------------------------------
    if (code === '' && label !== '') {
      const headingType = TYPE_HEADINGS[label.toUpperCase()];

      if (headingType) {
        currentType = headingType;
        currentTypeCode = categoryCodeOf(label);
        const category: UtbaCategory = {
          code: currentTypeCode,
          name: label,
          type: headingType,
          parentCode: null,
          rowNumber: row.rowNumber,
        };
        if (!usedCategoryCodes.has(category.code)) {
          usedCategoryCodes.add(category.code);
          categories.push(category);
        }
        currentCategory = category;
        continue;
      }

      if (currentType === null) {
        issues.push({
          rowNumber: row.rowNumber,
          code: null,
          severity: 'WARNING',
          message: `Blok "${label}" muncul sebelum ada judul jenis (TENAGA/MATERIAL/…), dan dilewati.`,
        });
        continue;
      }

      let subCode = categoryCodeOf(label);
      if (usedCategoryCodes.has(subCode)) subCode = `${subCode}-${row.rowNumber}`;
      usedCategoryCodes.add(subCode);

      currentCategory = {
        code: subCode,
        name: label,
        type: currentType,
        parentCode: currentTypeCode,
        rowNumber: row.rowNumber,
      };
      categories.push(currentCategory);
      continue;
    }

    if (code === '') continue;

    // --- data row ----------------------------------------------------------
    // Anything before the first block heading is the sheet's own preamble —
    // the title row and the column headers. Once a block has been seen the
    // type never becomes unknown again, so this can only ever be preamble.
    // It is counted and reported once rather than raised per row.
    if (currentType === null || currentCategory === null) {
      preambleRows += 1;
      continue;
    }

    const firstSeen = seenCodes.get(code);
    if (firstSeen !== undefined) {
      issues.push({
        rowNumber: row.rowNumber,
        code,
        severity: 'ERROR',
        message: `Kode "${code}" sudah dipakai di baris ${firstSeen}. Baris ini dilewati.`,
      });
      continue;
    }

    if (label === '') {
      issues.push({
        rowNumber: row.rowNumber,
        code,
        severity: 'ERROR',
        message: `Kode "${code}" tidak memiliki nama.`,
      });
      continue;
    }

    const unitRaw = textOf(row.get('E'));
    if (unitRaw === '') {
      issues.push({
        rowNumber: row.rowNumber,
        code,
        severity: 'ERROR',
        message: `Satuan untuk "${code}" kosong.`,
      });
      continue;
    }

    const price = parsePrice(row.get('F'));
    if (price === null) {
      issues.push({
        rowNumber: row.rowNumber,
        code,
        severity: 'ERROR',
        message: `Harga untuk "${code}" tidak dapat dibaca sebagai angka.`,
      });
      continue;
    }
    if (price.isNegative()) {
      issues.push({
        rowNumber: row.rowNumber,
        code,
        severity: 'ERROR',
        message: `Harga untuk "${code}" bernilai negatif.`,
      });
      continue;
    }
    if (price.isZero()) {
      issues.push({
        rowNumber: row.rowNumber,
        code,
        severity: 'WARNING',
        message: `Harga untuk "${code}" bernilai nol; periksa kembali sebelum dipakai di estimasi.`,
      });
    }

    const unitCode = normaliseUnit(unitRaw);
    if (unitDimension(unitCode) === null) {
      issues.push({
        rowNumber: row.rowNumber,
        code,
        severity: 'WARNING',
        message: `Satuan "${unitRaw}" belum dikenal; dianggap satuan hitung (COUNT). Periksa bila sebenarnya panjang, luas, volume, atau massa.`,
      });
    }
    unitUsage.set(unitCode, (unitUsage.get(unitCode) ?? 0) + 1);

    // Columns C and D carry the specification in two fragments, which the
    // sheet itself concatenates for display in column J.
    const spec = [textOf(row.get('C')), textOf(row.get('D'))].filter((s) => s !== '').join(' ');
    const note = textOf(row.get('G'));

    seenCodes.set(code, row.rowNumber);
    resources.push({
      rowNumber: row.rowNumber,
      code,
      name: label,
      spec: spec === '' ? null : spec,
      note: note === '' ? null : note,
      unitCode,
      price: price.toFixed(2),
      categoryCode: currentCategory.code,
      categoryName: currentCategory.name,
      type: currentType,
    });
  }

  if (preambleRows > 0) {
    issues.push({
      rowNumber: 0,
      code: null,
      severity: 'WARNING',
      message: `${preambleRows} baris sebelum blok pertama dilewati (judul dan header sheet).`,
    });
  }

  const units: UtbaUnit[] = [...unitUsage.entries()]
    .map(([code, usageCount]) => ({
      code,
      dimension: unitDimension(code) ?? ('COUNT' as const),
      usageCount,
    }))
    .sort((a, b) => a.code.localeCompare(b.code));

  return { resources, categories, units, issues };
}
