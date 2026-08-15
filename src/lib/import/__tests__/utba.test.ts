import { describe, expect, it } from 'vitest';

import { parsePrice, parseUtba, unitDimension, type SheetRow } from '../utba';

/** Builds sheet rows from `{ A: …, B: … }` literals, as the real sheet reads. */
function sheet(records: Record<string, string | number | null>[], startAt = 6): SheetRow[] {
  return records.map((cells, i) => ({
    rowNumber: startAt + i,
    get: (column: string) => cells[column] ?? null,
  }));
}

const HEADING = (name: string) => ({ B: name });

const RESOURCE = (
  code: string,
  name: string,
  unit: string,
  price: string | number,
  extra: Record<string, string> = {},
) => ({ A: code, B: name, E: unit, F: price, ...extra });

describe('parsePrice', () => {
  it('reads plain numbers exactly', () => {
    expect(parsePrice(250000)?.toFixed(2)).toBe('250000.00');
    expect(parsePrice('163725')?.toFixed(2)).toBe('163725.00');
  });

  it('reads Indonesian thousands and decimal separators', () => {
    expect(parsePrice('1.234.567')?.toFixed(2)).toBe('1234567.00');
    expect(parsePrice('15.500,50')?.toFixed(2)).toBe('15500.50');
    expect(parsePrice('Rp 250.000')?.toFixed(2)).toBe('250000.00');
  });

  it('still reads plain decimal points', () => {
    expect(parsePrice('15500.50')?.toFixed(2)).toBe('15500.50');
  });

  // A price that cannot be read exactly must not be guessed at.
  it('returns null for anything unreadable', () => {
    expect(parsePrice('')).toBeNull();
    expect(parsePrice(null)).toBeNull();
    expect(parsePrice('#REF!')).toBeNull();
    expect(parsePrice('tanya supplier')).toBeNull();
    expect(parsePrice(Number.NaN)).toBeNull();
  });
});

describe('unitDimension', () => {
  it('maps the units used by the workbook', () => {
    expect(unitDimension('m3')).toBe('VOLUME');
    expect(unitDimension('m2')).toBe('AREA');
    expect(unitDimension("m'")).toBe('LENGTH');
    expect(unitDimension('kg')).toBe('MASS');
    expect(unitDimension('ls')).toBe('LUMPSUM');
    expect(unitDimension('bln')).toBe('TIME');
  });

  it('is case insensitive', () => {
    expect(unitDimension('M3')).toBe('VOLUME');
    expect(unitDimension(' Kg ')).toBe('MASS');
  });

  it('knows the counting units the workbook uses', () => {
    expect(unitDimension('doss')).toBe('COUNT');
    expect(unitDimension('Tank')).toBe('COUNT');
    expect(unitDimension('btg')).toBe('COUNT');
  });

  it('reports a genuinely unfamiliar unit rather than inventing a dimension', () => {
    expect(unitDimension('kubikasi')).toBeNull();
    expect(unitDimension('')).toBeNull();
  });
});

describe('parseUtba — block structure', () => {
  const rows = sheet([
    HEADING('TENAGA'),
    HEADING('Irengan'),
    RESOURCE('PI.01', 'Pekerjaan pembersihan', 'm2', 1440),
    HEADING('Non Irengan'),
    RESOURCE('PN.01', 'Tukang batu', 'hr', 150000),
    HEADING('MATERIAL'),
    HEADING('Material dasar'),
    RESOURCE('M.01', 'batu', 'm3', 250000, { C: 'batu belah', D: '15/20' }),
    HEADING('Paket Pekerjaan'),
    RESOURCE('PP.01', 'rangka atap baja ringan', 'm2', 163725),
    HEADING('Operasional'),
    RESOURCE('OP.1.1', 'Harian Pelaksana', 'mg', 188000),
  ]);

  const result = parseUtba(rows);

  it('assigns the type of the enclosing block', () => {
    const byCode = new Map(result.resources.map((r) => [r.code, r]));
    expect(byCode.get('PI.01')?.type).toBe('LABOR');
    expect(byCode.get('PN.01')?.type).toBe('LABOR');
    expect(byCode.get('M.01')?.type).toBe('MATERIAL');
    expect(byCode.get('PP.01')?.type).toBe('PACKAGE');
    expect(byCode.get('OP.1.1')?.type).toBe('OVERHEAD');
  });

  it('nests sub-blocks under the type heading', () => {
    const irengan = result.categories.find((c) => c.name === 'Irengan');
    expect(irengan?.parentCode).toBe('TENAGA');
    expect(irengan?.type).toBe('LABOR');

    const tenaga = result.categories.find((c) => c.name === 'TENAGA');
    expect(tenaga?.parentCode).toBeNull();
  });

  it('records which category each resource came from', () => {
    const m01 = result.resources.find((r) => r.code === 'M.01');
    expect(m01?.categoryName).toBe('Material dasar');
  });

  it('joins columns C and D into the specification', () => {
    const m01 = result.resources.find((r) => r.code === 'M.01');
    expect(m01?.spec).toBe('batu belah 15/20');
  });

  it('leaves the specification null when both fragments are empty', () => {
    const pp01 = result.resources.find((r) => r.code === 'PP.01');
    expect(pp01?.spec).toBeNull();
  });

  it('collects the units actually used, with their dimensions', () => {
    const m3 = result.units.find((u) => u.code === 'm3');
    expect(m3).toEqual({ code: 'm3', dimension: 'VOLUME', usageCount: 1 });
  });

  it('parses every well-formed row', () => {
    expect(result.resources).toHaveLength(5);
    expect(result.issues.filter((i) => i.severity === 'ERROR')).toHaveLength(0);
  });
});

describe('parseUtba — defects', () => {
  it('keeps the first of a duplicated code and reports the second', () => {
    const result = parseUtba(
      sheet([
        HEADING('MATERIAL'),
        RESOURCE('M.01', 'semen', 'zak', 48000),
        RESOURCE('M.01', 'semen lain', 'zak', 52000),
      ]),
    );

    expect(result.resources).toHaveLength(1);
    expect(result.resources[0]?.price).toBe('48000.00');
    const errors = result.issues.filter((i) => i.severity === 'ERROR');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toMatch(/sudah dipakai di baris/);
  });

  it('rejects a row whose price cannot be read', () => {
    const result = parseUtba(
      sheet([HEADING('MATERIAL'), RESOURCE('M.02', 'pasir', 'm3', '#REF!')]),
    );
    expect(result.resources).toHaveLength(0);
    expect(result.issues[0]?.message).toMatch(/tidak dapat dibaca sebagai angka/);
  });

  it('rejects a negative price', () => {
    const result = parseUtba(sheet([HEADING('MATERIAL'), RESOURCE('M.03', 'kricak', 'm3', -100)]));
    expect(result.resources).toHaveLength(0);
    expect(result.issues[0]?.message).toMatch(/negatif/);
  });

  // Zero is legal — some package lines genuinely cost nothing yet — but the
  // operator should be told before it lands in an estimate.
  it('keeps a zero price but warns', () => {
    const result = parseUtba(sheet([HEADING('MATERIAL'), RESOURCE('M.04', 'hibah', 'bh', 0)]));
    expect(result.resources).toHaveLength(1);
    expect(result.issues[0]?.severity).toBe('WARNING');
  });

  it('rejects rows with no unit or no name', () => {
    const result = parseUtba(
      sheet([
        HEADING('MATERIAL'),
        { A: 'M.05', B: 'tanpa satuan', E: '', F: 1000 },
        { A: 'M.06', B: '', E: 'bh', F: 1000 },
      ]),
    );
    expect(result.resources).toHaveLength(0);
    expect(result.issues.map((i) => i.code)).toEqual(['M.05', 'M.06']);
  });

  it('warns on an unrecognised unit but still imports the row', () => {
    const result = parseUtba(
      sheet([HEADING('MATERIAL'), RESOURCE('M.07', 'keramik', 'kubikasi', 90000)]),
    );
    expect(result.resources).toHaveLength(1);
    expect(result.resources[0]?.unitCode).toBe('kubikasi');
    expect(result.units[0]?.dimension).toBe('COUNT');
    expect(result.issues[0]?.message).toMatch(/belum dikenal/);
  });

  it('does not warn about the counting units the workbook already uses', () => {
    const result = parseUtba(
      sheet([
        HEADING('MATERIAL'),
        RESOURCE('M.10', 'keramik', 'doss', 90000),
        RESOURCE('M.11', 'besi', 'btg', 120000),
      ]),
    );
    expect(result.issues).toHaveLength(0);
  });

  // The sheet opens with a title row and a header row. Those are preamble, not
  // defects, and reporting them per row would bury the real findings.
  it('skips preamble rows and reports them once', () => {
    const result = parseUtba(
      sheet([
        { A: 0, F: 0 },
        { A: 'KODE', B: 'TENAGA/MATERIAL', E: 'SAT', F: 'HARGA' },
        HEADING('MATERIAL'),
        RESOURCE('M.01', 'semen', 'zak', 48000),
      ]),
    );

    expect(result.resources).toHaveLength(1);
    expect(result.issues.filter((i) => i.severity === 'ERROR')).toHaveLength(0);
    const warnings = result.issues.filter((i) => i.severity === 'WARNING');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toMatch(/2 baris sebelum blok pertama dilewati/);
  });

  it('normalises unit case so "Tank" and "tank" are one unit', () => {
    const result = parseUtba(
      sheet([
        HEADING('MATERIAL'),
        RESOURCE('M.08', 'air', 'Tank', 400000),
        RESOURCE('M.09', 'air lagi', 'tank', 400000),
      ]),
    );
    expect(result.units).toHaveLength(1);
    expect(result.units[0]?.usageCount).toBe(2);
  });

  it('handles an empty sheet without throwing', () => {
    const result = parseUtba([]);
    expect(result).toEqual({ resources: [], categories: [], units: [], issues: [] });
  });
});
