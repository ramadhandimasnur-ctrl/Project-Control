import { describe, expect, it } from 'vitest';

import {
  cashflowSheet,
  cellValue,
  exportFileName,
  financeSheets,
  progressSheets,
  safeSheetName,
} from '../sheets';

describe('cellValue', () => {
  // Exporting "Rp 1.500.000" as text gives a column that cannot sum itself.
  it('keeps money as a number', () => {
    expect(cellValue('1500000', 'money')).toBe(1500000);
  });

  // Excel's percent format expects the 0..1 fraction, exactly as stored.
  it('passes percentages through unscaled', () => {
    expect(cellValue('0.5', 'percent')).toBe(0.5);
  });

  it('leaves text alone', () => {
    expect(cellValue('A.01', 'text')).toBe('A.01');
  });

  it('keeps dates as text for the writer to format', () => {
    expect(cellValue('2026-08-15', 'date')).toBe('2026-08-15');
  });

  it('renders a missing value as an empty cell, not a zero', () => {
    for (const empty of [null, undefined, '']) {
      expect(cellValue(empty, 'money')).toBeNull();
    }
  });

  it('refuses to write a number it cannot parse', () => {
    expect(cellValue('tidak diketahui', 'money')).toBeNull();
  });
});

describe('safeSheetName', () => {
  it('strips the characters Excel refuses', () => {
    expect(safeSheetName('RAB/RAP: 2026*')).toBe('RAB RAP  2026');
  });

  it('truncates to the thirty-one character limit', () => {
    expect(safeSheetName('x'.repeat(50))).toHaveLength(31);
  });

  it('never returns an empty name', () => {
    expect(safeSheetName('///')).toBe('Sheet');
  });
});

describe('exportFileName', () => {
  it('builds a name a filesystem will accept', () => {
    expect(exportFileName('COBA-01', 'arus-kas', '2026-08-16')).toBe(
      'COBA-01-arus-kas-2026-08-16.xlsx',
    );
  });

  it('replaces anything unsafe with a hyphen', () => {
    expect(exportFileName('PRJ/01', 'kas', '2026-08-16')).toBe('PRJ-01-kas-2026-08-16.xlsx');
  });
});

describe('cashflowSheet', () => {
  const sheet = cashflowSheet({
    preamble: ['Proyek A'],
    flow: [
      {
        label: 'Januari 2026',
        opening: '0',
        inflow: '5000000',
        outflow: '2000000',
        net: '3000000',
        closing: '3000000',
      },
    ],
  });

  it('names every column the report needs', () => {
    expect(sheet.columns.map((c) => c.header)).toEqual([
      'Periode',
      'Saldo awal',
      'Masuk',
      'Keluar',
      'Bersih',
      'Saldo akhir',
    ]);
  });

  it('formats every money column as money', () => {
    const money = sheet.columns.filter((c) => c.key !== 'label');
    expect(money.every((c) => c.format === 'money')).toBe(true);
  });

  it('carries one row per period', () => {
    expect(sheet.rows).toHaveLength(1);
    expect(sheet.rows[0]?.closing).toBe('3000000');
  });
});

describe('financeSheets', () => {
  const sheets = financeSheets({
    preamble: ['Proyek A'],
    items: [
      {
        code: 'A.01',
        name: 'Galian',
        unitCode: 'm3',
        volume: '100',
        totalRab: '1000',
        totalRap: '800',
        contractValue: '1200',
        margin: '400',
        weight: '0.25',
      },
    ],
    byCategory: [{ category: 'MATERIAL', amount: '500' }],
  });

  it('splits the estimate and the realisation into their own sheets', () => {
    expect(sheets.map((s) => s.name)).toEqual(['RAB vs RAP', 'Realisasi Biaya']);
  });

  it('formats the weight column as a percentage', () => {
    const weight = sheets[0]?.columns.find((c) => c.key === 'weight');
    expect(weight?.format).toBe('percent');
  });
});

describe('progressSheets', () => {
  const sheets = progressSheets({
    preamble: ['Proyek A'],
    columns: { previous: 'Minggu lalu', current: 'Minggu ini', cumulative: 's.d. minggu ini' },
    curve: [
      {
        label: 'M1',
        plannedPct: '0.1',
        plannedCumulative: '0.1',
        actualCumulative: '0.08',
        deviation: '-0.02',
      },
      {
        label: 'M2',
        plannedPct: '0.2',
        plannedCumulative: '0.3',
        actualCumulative: null,
        deviation: null,
      },
    ],
    items: [
      {
        code: 'A.01',
        name: 'Galian',
        unitCode: 'm3',
        weight: '0.25',
        previous: '0.125',
        current: '0.05',
        cumulative: '0.175',
        planned: '0.2',
        deviation: '-0.025',
        completedBefore: '0.5',
        pctThisPeriod: '0.2',
        status: 'Disetujui',
      },
    ],
  });

  it('produces a curve sheet and a work item sheet', () => {
    expect(sheets.map((s) => s.name)).toEqual(['Kurva-S', 'Rekap Pekerjaan']);
  });

  // An unreported period should be blank, not zero — they mean different things.
  it('keeps an unreported period empty rather than zero', () => {
    const row = sheets[0]?.rows[1];
    expect(row?.actualCumulative).toBeNull();
    expect(cellValue(row?.actualCumulative, 'percent')).toBeNull();
  });

  it('every column has a width, so nothing opens as ####', () => {
    for (const sheet of sheets) {
      expect(sheet.columns.every((c) => c.width > 0)).toBe(true);
    }
  });
});
