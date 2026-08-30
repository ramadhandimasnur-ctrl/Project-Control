import { describe, expect, it } from 'vitest';

import { parseAhspLibrary } from '../ahsp-library';
import { type SheetRow } from '../utba';

/**
 * The library parser, on the shapes the real workbook actually contains.
 *
 * Every case here was taken from the national library rather than invented:
 * coefficients arriving as float noise, resources named without a code, and
 * the source's own category words.
 */

/** Builds a sheet row from a column-letter map, as ExcelJS would hand it over. */
const row = (rowNumber: number, cells: Record<string, string | number | null>): SheetRow => ({
  rowNumber,
  get: (column: string) => cells[column] ?? null,
});

const entry = (over: Record<string, string | number | null> = {}) =>
  row(2, {
    A: 'LIB-0000001',
    B: '1.1.1.1',
    C: 'Pembuatan 1 m pagar sementara dari kayu tinggi 2 meter',
    D: "m'",
    E: 'AHSP Cipta Karya',
    F: 2026,
    G: 'SE Bina Konstruksi',
    I: 'Persiapan',
    J: 12,
    R: 'ACTIVE',
    ...over,
  });

const item = (over: Record<string, string | number | null> = {}) =>
  row(2, {
    A: 'LBD-00000001',
    B: 'LIB-0000001',
    C: 'L.01',
    D: 'Pekerja',
    E: 'TENAGA',
    F: 'OH',
    G: 0.6,
    H: 1,
    P: 'ACTIVE',
    ...over,
  });

describe('parseAhspLibrary', () => {
  it('menyusun analisa beserta rinciannya', () => {
    const result = parseAhspLibrary([entry()], [item()]);

    expect(result.issues).toEqual([]);
    expect(result.entries).toHaveLength(1);

    const [parsed] = result.entries;
    expect(parsed?.code).toBe('1.1.1.1');
    expect(parsed?.sourceName).toBe('AHSP Cipta Karya');
    expect(parsed?.sourceYear).toBe(2026);
    expect(parsed?.items).toHaveLength(1);
    expect(parsed?.items[0]?.role).toBe('LABOR');
  });

  /*
   * The source stores coefficients as floats, so 0,013 arrives as
   * 1.2999999999999999E-2. Left alone it would be stored as that, and the
   * printed analysis would carry a number nobody typed.
   */
  it('membulatkan derau titik-mengambang pada koefisien', () => {
    const result = parseAhspLibrary([entry()], [item({ G: '1.2999999999999999E-2' })]);
    expect(result.entries[0]?.items[0]?.coef).toBe('0.013000');
  });

  // 590 of the library's 16.136 lines carry a code. The rest are legitimate.
  it('menerima baris tanpa kode sumber daya', () => {
    const result = parseAhspLibrary(
      [entry()],
      [item({ C: null, D: 'Kaso 5/7 kayu kelas II', E: 'MATERIAL', F: 'm3', G: 0.0387 })],
    );

    expect(result.issues).toEqual([]);
    expect(result.entries[0]?.items[0]?.resourceCode).toBeNull();
    expect(result.entries[0]?.items[0]?.role).toBe('MATERIAL');
  });

  it('memetakan kategori sumber ke peran aplikasi', () => {
    const result = parseAhspLibrary(
      [entry()],
      [
        item({ A: 'a', E: 'TENAGA', H: 1 }),
        item({ A: 'b', E: 'MATERIAL', H: 2 }),
        item({ A: 'c', E: 'ALAT', H: 3 }),
        item({ A: 'd', E: 'LAIN', H: 4 }),
      ],
    );

    expect(result.entries[0]?.items.map((i) => i.role)).toEqual([
      'LABOR',
      'MATERIAL',
      'EQUIPMENT',
      'PACKAGE',
    ]);
  });

  it('melaporkan kategori yang tidak dikenal alih-alih menebaknya', () => {
    const result = parseAhspLibrary([entry()], [item({ E: 'ENTAH' })]);

    expect(result.entries).toHaveLength(0);
    expect(result.issues.some((i) => i.message.includes('ENTAH'))).toBe(true);
  });

  it('melaporkan rincian yang menunjuk analisa yang tidak ada', () => {
    const result = parseAhspLibrary([entry()], [item({ B: 'LIB-9999999' })]);
    expect(result.issues.some((i) => i.message.includes('LIB-9999999'))).toBe(true);
  });

  // A soft-deleted row is not a row.
  it('melewati baris yang sudah dihapus di sumbernya', () => {
    expect(parseAhspLibrary([entry({ R: 'DELETED' })], [item()]).entries).toHaveLength(0);
    expect(parseAhspLibrary([entry()], [item({ P: 'DELETED' })]).entries).toHaveLength(0);
  });

  /*
   * An analysis with a name and no lines has no unit rate to give. Importing
   * it would put an entry in the library that produces nothing when applied.
   */
  it('membuang analisa tanpa satu pun baris', () => {
    const result = parseAhspLibrary([entry()], []);
    expect(result.entries).toHaveLength(0);
    expect(result.issues.some((i) => i.message.includes('tanpa satu pun baris'))).toBe(true);
  });

  it('mengurutkan rincian menurut urutan sumbernya', () => {
    const result = parseAhspLibrary(
      [entry()],
      [item({ A: 'x', D: 'Mandor', H: 9 }), item({ A: 'y', D: 'Pekerja', H: 1 })],
    );
    expect(result.entries[0]?.items.map((i) => i.resourceName)).toEqual(['Pekerja', 'Mandor']);
  });

  it('menolak koefisien negatif', () => {
    const result = parseAhspLibrary([entry()], [item({ G: -1 })]);
    expect(result.entries).toHaveLength(0);
    expect(result.issues.some((i) => i.message.includes('Koefisien'))).toBe(true);
  });
});
