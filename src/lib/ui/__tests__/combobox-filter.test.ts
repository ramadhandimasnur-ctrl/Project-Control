import { describe, expect, it } from 'vitest';

import { filterIndexed, haystackOf, indexOptions, matches, termsOf } from '../combobox-filter';

/** A slice of the real catalogue, including its awkward cases. */
const CATALOGUE = [
  { value: '1', code: 'M.24', label: 'besi tulangan', description: 'polos ø12', meta: 'btg' },
  { value: '2', code: 'M.25', label: 'besi tulangan', description: 'ulir ø12', meta: 'btg' },
  { value: '3', code: 'M.01', label: 'batu', description: 'batu belah 15/20', meta: 'm3' },
  { value: '4', code: 'PI.07', label: 'pasang pondasi batu belah', meta: 'm3' },
  { value: '5', code: 'ME.01', label: 'fitting', description: 'outbow', meta: 'bh' },
  { value: '6', code: 'OP.1.1', label: 'Harian Pelaksana', meta: 'mg' },
];

const indexed = indexOptions(CATALOGUE);
const find = (query: string) => filterIndexed(indexed, query).map((o) => o.code);

describe('termsOf', () => {
  it('splits on whitespace and lowercases', () => {
    expect(termsOf('  Besi   ø12 ')).toEqual(['besi', 'ø12']);
  });

  it('is empty for a blank query', () => {
    expect(termsOf('   ')).toEqual([]);
  });
});

describe('haystackOf', () => {
  it('joins every searchable part', () => {
    expect(haystackOf(CATALOGUE[0]!)).toBe('m.24 besi tulangan polos ø12 btg');
  });

  it('skips parts a row does not have', () => {
    expect(haystackOf(CATALOGUE[5]!)).toBe('op.1.1 harian pelaksana mg');
  });
});

describe('matches', () => {
  it('requires every term', () => {
    expect(matches('m.24 besi tulangan polos ø12', ['besi', 'polos'])).toBe(true);
    expect(matches('m.24 besi tulangan polos ø12', ['besi', 'ulir'])).toBe(false);
  });

  it('matches partial words', () => {
    expect(matches('besi tulangan', ['tul'])).toBe(true);
  });
});

describe('filterIndexed', () => {
  it('returns everything for an empty query', () => {
    expect(find('')).toHaveLength(CATALOGUE.length);
    expect(find('   ')).toHaveLength(CATALOGUE.length);
  });

  it('finds by code', () => {
    expect(find('M.24')).toEqual(['M.24']);
    expect(find('op.1')).toEqual(['OP.1.1']);
  });

  it('is case insensitive', () => {
    expect(find('BESI')).toEqual(['M.24', 'M.25']);
    expect(find('harian pelaksana')).toEqual(['OP.1.1']);
  });

  it('finds by partial name', () => {
    expect(find('tulang')).toEqual(['M.24', 'M.25']);
  });

  it('finds by specification', () => {
    expect(find('ulir')).toEqual(['M.25']);
    expect(find('outbow')).toEqual(['ME.01']);
  });

  // The reason terms are ANDed rather than matched as one phrase.
  it('narrows as terms are added', () => {
    expect(find('besi')).toEqual(['M.24', 'M.25']);
    expect(find('besi polos')).toEqual(['M.24']);
  });

  // Someone recalling a spec rarely recalls the order it was written in.
  it('ignores the order of terms', () => {
    expect(find('polos besi')).toEqual(find('besi polos'));
    expect(find('ø12 besi')).toEqual(['M.24', 'M.25']);
  });

  it('matches across code and name at once', () => {
    expect(find('m.24 besi')).toEqual(['M.24']);
  });

  it('finds a phrase that spans two rows differently', () => {
    // "batu belah" appears in a material spec and in a labour item's name.
    expect(find('batu belah')).toEqual(['M.01', 'PI.07']);
  });

  it('returns nothing when no row matches', () => {
    expect(find('kubikasi beton pracetak')).toEqual([]);
  });

  it('does not mutate the index', () => {
    const before = indexed.map((e) => e.option.code);
    filterIndexed(indexed, 'besi');
    expect(indexed.map((e) => e.option.code)).toEqual(before);
  });

  // 379 options is the real catalogue size; filtering has to stay trivial.
  it('stays fast over a catalogue-sized list', () => {
    const many = Array.from({ length: 400 }, (_, i) => ({
      value: String(i),
      code: `M.${i}`,
      label: `material ${i}`,
      description: `spesifikasi ${i}`,
    }));
    const bigIndex = indexOptions(many);

    const started = performance.now();
    for (let i = 0; i < 50; i += 1) filterIndexed(bigIndex, 'material 12');
    const elapsed = performance.now() - started;

    // Fifty keystrokes' worth of filtering, comfortably inside a frame budget.
    expect(elapsed).toBeLessThan(100);
    expect(filterIndexed(bigIndex, 'material 12').map((o) => o.code)).toContain('M.12');
  });
});
