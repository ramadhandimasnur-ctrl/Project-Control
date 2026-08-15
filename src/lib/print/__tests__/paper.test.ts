import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PAPER,
  PAPERS,
  contentWidthMm,
  pageRule,
  paperById,
  parsePaperSetting,
  sheetSize,
  type PaperSetting,
} from '../paper';

const setting = (over: Partial<PaperSetting> = {}): PaperSetting => ({
  ...DEFAULT_PAPER,
  ...over,
});

describe('PAPERS', () => {
  it('carries the sizes an Indonesian office actually stocks', () => {
    const ids = PAPERS.map((p) => p.id);
    expect(ids).toContain('A4');
    expect(ids).toContain('F4');
  });

  // F4 has no CSS keyword; getting it wrong is the whole reason for the module.
  it('states F4 as 215 by 330 millimetres', () => {
    expect(paperById('F4')).toMatchObject({ widthMm: 215, heightMm: 330 });
  });

  it('falls back to the first paper for an unknown id', () => {
    expect(paperById('NOPE' as never).id).toBe('A4');
  });
});

describe('sheetSize', () => {
  it('leaves portrait alone', () => {
    expect(sheetSize(setting({ paper: 'A4' }))).toEqual({ widthMm: 210, heightMm: 297 });
  });

  it('swaps the sides for landscape', () => {
    expect(sheetSize(setting({ paper: 'A4', orientation: 'LANDSCAPE' }))).toEqual({
      widthMm: 297,
      heightMm: 210,
    });
  });

  it('swaps F4 too', () => {
    expect(sheetSize(setting({ paper: 'F4', orientation: 'LANDSCAPE' }))).toEqual({
      widthMm: 330,
      heightMm: 215,
    });
  });
});

describe('contentWidthMm', () => {
  it('takes both margins off the width', () => {
    expect(contentWidthMm(setting({ paper: 'A4', margin: 'NORMAL' }))).toBe(210 - 28);
    expect(contentWidthMm(setting({ paper: 'A4', margin: 'NARROW' }))).toBe(210 - 20);
    expect(contentWidthMm(setting({ paper: 'A4', margin: 'WIDE' }))).toBe(210 - 40);
  });

  it('measures the landscape width', () => {
    expect(contentWidthMm(setting({ paper: 'A4', orientation: 'LANDSCAPE', margin: 'NORMAL' }))).toBe(
      297 - 28,
    );
  });

  // A5 with wide margins is the tightest real combination.
  it('never collapses to zero', () => {
    expect(contentWidthMm(setting({ paper: 'A5', margin: 'WIDE' }))).toBeGreaterThan(0);
  });
});

describe('pageRule', () => {
  it('emits explicit millimetres rather than a keyword', () => {
    expect(pageRule(setting({ paper: 'A4' }))).toBe('@page { size: 210mm 297mm; margin: 14mm; }');
  });

  it('emits the folio size a keyword cannot express', () => {
    expect(pageRule(setting({ paper: 'F4', margin: 'NARROW' }))).toBe(
      '@page { size: 215mm 330mm; margin: 10mm; }',
    );
  });

  it('reflects landscape in the rule itself', () => {
    expect(pageRule(setting({ paper: 'LEGAL', orientation: 'LANDSCAPE', margin: 'WIDE' }))).toBe(
      '@page { size: 356mm 216mm; margin: 20mm; }',
    );
  });
});

describe('parsePaperSetting', () => {
  it('accepts a well-formed setting', () => {
    const stored = { paper: 'F4', orientation: 'LANDSCAPE', margin: 'WIDE' };
    expect(parsePaperSetting(stored)).toEqual(stored);
  });

  // Whatever is in localStorage was put there by an older build, or by hand.
  it('falls back field by field, not all or nothing', () => {
    expect(parsePaperSetting({ paper: 'F4', orientation: 'SIDEWAYS' })).toEqual({
      paper: 'F4',
      orientation: 'PORTRAIT',
      margin: 'NORMAL',
    });
  });

  it('survives junk', () => {
    for (const junk of [null, undefined, 'A4', 42, []]) {
      expect(parsePaperSetting(junk)).toEqual(DEFAULT_PAPER);
    }
  });
});
