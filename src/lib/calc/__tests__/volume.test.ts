import { describe, expect, it } from 'vitest';

import { evaluateExpression, resolveTakeoffQty, takeoffTotal } from '../volume';

const value = (expression: string) => {
  const result = evaluateExpression(expression);
  return result.ok ? result.value.toString() : `ERROR: ${result.message}`;
};

const failure = (expression: string) => {
  const result = evaluateExpression(expression);
  return result.ok ? 'unexpectedly succeeded' : result.message;
};

describe('takeoffTotal', () => {
  it('sums the rows exactly', () => {
    expect(
      takeoffTotal([{ qty: '2.025' }, { qty: '3.5' }, { qty: '0.475' }]).toString(),
    ).toBe('6');
  });

  it('is zero for no rows', () => {
    expect(takeoffTotal([]).toString()).toBe('0');
  });

  // Floats would give 0.30000000000000004 here.
  it('does not drift on fractional metres', () => {
    expect(takeoffTotal([{ qty: '0.1' }, { qty: '0.2' }]).toString()).toBe('0.3');
  });
});

describe('evaluateExpression — arithmetic', () => {
  it('evaluates a plain multiplication chain', () => {
    expect(value('3 * 4.5 * 0.15')).toBe('2.025');
  });

  it('respects precedence and parentheses', () => {
    expect(value('2 + 3 * 4')).toBe('14');
    expect(value('(2 + 3) * 4')).toBe('20');
    expect(value('2 * (3 + 4) - 5')).toBe('9');
  });

  it('divides exactly', () => {
    expect(value('10 / 4')).toBe('2.5');
  });

  it('handles a leading sign', () => {
    expect(value('-2 + 5')).toBe('3');
    expect(value('+7')).toBe('7');
  });

  it('handles nested parentheses', () => {
    expect(value('((1 + 2) * (3 + 4))')).toBe('21');
  });
});

describe('evaluateExpression — Indonesian notation', () => {
  // How a take-off is actually written on site.
  it('accepts a comma as the decimal separator', () => {
    expect(value('3 × 4,5 × 0,15')).toBe('2.025');
  });

  it('accepts × and x as multiplication', () => {
    expect(value('4 × 5')).toBe('20');
    expect(value('4 x 5')).toBe('20');
    expect(value('4 X 5')).toBe('20');
  });

  it('accepts ÷ and : as division', () => {
    expect(value('10 ÷ 4')).toBe('2.5');
    expect(value('10 : 4')).toBe('2.5');
  });

  it('accepts the typographic minus', () => {
    expect(value('10 − 4')).toBe('6');
  });

  it('works without spaces', () => {
    expect(value('3x4,5x0,15')).toBe('2.025');
  });
});

describe('evaluateExpression — refusals', () => {
  // The whole reason this parser exists rather than eval().
  it('refuses anything that is not arithmetic', () => {
    expect(failure('process.exit(1)')).toMatch(/tidak dapat dipakai|tidak dikenal/i);
    expect(failure('require("fs")')).toMatch(/tidak dapat dipakai|tidak dikenal/i);
    expect(failure('1; DROP TABLE resources')).toMatch(/tidak dapat dipakai|tidak dikenal/i);
  });

  it('reports an empty expression', () => {
    expect(failure('')).toMatch(/masih kosong/i);
    expect(failure('   ')).toMatch(/masih kosong/i);
  });

  it('reports unbalanced parentheses', () => {
    expect(failure('(2 + 3')).toMatch(/tidak ditutup/i);
    expect(failure('2 + 3)')).toMatch(/tidak dapat dibaca|tanpa kurung buka/i);
  });

  it('reports a dangling operator', () => {
    expect(failure('2 +')).toMatch(/berakhir sebelum selesai/i);
    expect(failure('* 3')).toMatch(/tidak dapat dibaca|berakhir/i);
  });

  it('refuses division by zero rather than returning Infinity', () => {
    expect(failure('10 / 0')).toMatch(/membagi dengan nol/i);
  });

  it('refuses a negative result, since a volume cannot be negative', () => {
    expect(failure('3 - 10')).toMatch(/negatif/i);
  });

  it('reports a number with two decimal separators', () => {
    expect(failure('1,5,5')).toMatch(/lebih dari satu koma/i);
  });
});

describe('resolveTakeoffQty', () => {
  it('uses the expression when one is given', () => {
    const result = resolveTakeoffQty({ expression: '3 × 4,5 × 0,15', qty: '99' });
    expect(result.ok && result.value.toString()).toBe('2.025');
  });

  // A stored quantity that disagrees with its own arithmetic is exactly the
  // silent discrepancy this system exists to prevent.
  it('prefers the expression over a conflicting stored quantity', () => {
    const result = resolveTakeoffQty({ expression: '2 * 2', qty: '10' });
    expect(result.ok && result.value.toString()).toBe('4');
  });

  it('falls back to the stored quantity when there is no expression', () => {
    expect(resolveTakeoffQty({ qty: '12.5' }).ok).toBe(true);
    expect(resolveTakeoffQty({ expression: null, qty: '12.5' }).ok).toBe(true);
    expect(resolveTakeoffQty({ expression: '  ', qty: '12.5' }).ok).toBe(true);
  });

  it('refuses a negative stored quantity', () => {
    const result = resolveTakeoffQty({ qty: '-1' });
    expect(result.ok).toBe(false);
  });

  it('reports an unreadable stored quantity', () => {
    const result = resolveTakeoffQty({ qty: 'dua meter' });
    expect(result.ok).toBe(false);
  });
});

describe('worked example from the source workbook', () => {
  // A slab: 3 m x 4,5 m x 0,15 m, twice, plus a 0,475 m3 offcut.
  it('builds a volume from several rows', () => {
    const rows = [
      { label: 'Pelat A', expression: '3 × 4,5 × 0,15', qty: '0' },
      { label: 'Pelat B', expression: '3 × 4,5 × 0,15', qty: '0' },
      { label: 'Sisa', expression: null, qty: '0.475' },
    ];

    const resolved = rows.map((row) => {
      const result = resolveTakeoffQty(row);
      return { qty: result.ok ? result.value : '0' };
    });

    expect(takeoffTotal(resolved).toString()).toBe('4.525');
  });
});
