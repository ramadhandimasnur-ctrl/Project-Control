import { describe, expect, it } from 'vitest';

import {
  priceOrigin,
  selectEffectivePrice,
  type PriceCandidate,
} from '../price';

const ORG = (price: string, effectiveFrom: string, priceType: 'RAB' | 'RAP' = 'RAP', id?: string) =>
  ({ price, effectiveFrom, projectId: null, priceType, ...(id ? { id } : {}) }) satisfies PriceCandidate;

const PROJECT = (
  price: string,
  effectiveFrom: string,
  projectId = 'p1',
  priceType: 'RAB' | 'RAP' = 'RAP',
  id?: string,
) => ({ price, effectiveFrom, projectId, priceType, ...(id ? { id } : {}) }) satisfies PriceCandidate;

const ON = (onDate: string, projectId: string | null = 'p1', priceType: 'RAB' | 'RAP' = 'RAP') => ({
  projectId,
  priceType,
  onDate,
});

describe('selectEffectivePrice — precedence', () => {
  it('prefers the project override over the organisation default', () => {
    const result = selectEffectivePrice(
      [ORG('48000', '2026-01-01'), PROJECT('46000', '2026-01-01')],
      ON('2026-03-01'),
    );
    expect(result?.price).toBe('46000');
    expect(priceOrigin(result!)).toBe('PROJECT_OVERRIDE');
  });

  it('falls back to the organisation default when the project has none', () => {
    const result = selectEffectivePrice([ORG('48000', '2026-01-01')], ON('2026-03-01'));
    expect(result?.price).toBe('48000');
    expect(priceOrigin(result!)).toBe('ORGANISATION_DEFAULT');
  });

  // A different project's override must never leak across.
  it('ignores an override belonging to another project', () => {
    const result = selectEffectivePrice(
      [ORG('48000', '2026-01-01'), PROJECT('30000', '2026-01-01', 'other-project')],
      ON('2026-03-01'),
    );
    expect(result?.price).toBe('48000');
  });

  it('uses only organisation defaults when resolving without a project', () => {
    const result = selectEffectivePrice(
      [ORG('48000', '2026-01-01'), PROJECT('46000', '2026-01-01')],
      ON('2026-03-01', null),
    );
    expect(result?.price).toBe('48000');
  });

  it('returns null when nothing matches', () => {
    expect(selectEffectivePrice([], ON('2026-03-01'))).toBeNull();
  });
});

describe('selectEffectivePrice — effective dates', () => {
  it('takes the most recent price already in force', () => {
    const result = selectEffectivePrice(
      [ORG('48000', '2026-01-01'), ORG('52000', '2026-02-01'), ORG('55000', '2026-03-01')],
      ON('2026-02-15'),
    );
    expect(result?.price).toBe('52000');
  });

  // An agreed increase entered ahead of time must not re-price past work.
  it('ignores a price that is not yet in force', () => {
    const result = selectEffectivePrice(
      [ORG('48000', '2026-01-01'), ORG('60000', '2026-06-01')],
      ON('2026-03-01'),
    );
    expect(result?.price).toBe('48000');
  });

  it('treats a price effective exactly on the date as in force', () => {
    const result = selectEffectivePrice([ORG('52000', '2026-02-01')], ON('2026-02-01'));
    expect(result?.price).toBe('52000');
  });

  it('returns null when every price starts after the date', () => {
    expect(selectEffectivePrice([ORG('48000', '2026-05-01')], ON('2026-03-01'))).toBeNull();
  });

  it('applies the date rule to project overrides too', () => {
    // The override exists but is not yet in force, so the default stands.
    const result = selectEffectivePrice(
      [ORG('48000', '2026-01-01'), PROJECT('42000', '2026-04-01')],
      ON('2026-03-01'),
    );
    expect(result?.price).toBe('48000');
  });

  it('falls back to an older project override rather than a newer default', () => {
    const result = selectEffectivePrice(
      [ORG('55000', '2026-03-01'), PROJECT('46000', '2026-01-01')],
      ON('2026-03-15'),
    );
    expect(result?.price).toBe('46000');
  });
});

describe('selectEffectivePrice — price type', () => {
  it('keeps RAB and RAP apart', () => {
    const candidates = [ORG('50000', '2026-01-01', 'RAB'), ORG('48000', '2026-01-01', 'RAP')];
    expect(selectEffectivePrice(candidates, ON('2026-03-01', 'p1', 'RAB'))?.price).toBe('50000');
    expect(selectEffectivePrice(candidates, ON('2026-03-01', 'p1', 'RAP'))?.price).toBe('48000');
  });

  it('returns null when only the other price type exists', () => {
    const result = selectEffectivePrice(
      [ORG('48000', '2026-01-01', 'RAP')],
      ON('2026-03-01', 'p1', 'RAB'),
    );
    expect(result).toBeNull();
  });
});

describe('selectEffectivePrice — determinism', () => {
  it('resolves a same-date collision the same way regardless of input order', () => {
    const a = ORG('48000', '2026-01-01', 'RAP', 'aaa');
    const b = ORG('52000', '2026-01-01', 'RAP', 'bbb');

    expect(selectEffectivePrice([a, b], ON('2026-03-01'))?.price).toBe('52000');
    expect(selectEffectivePrice([b, a], ON('2026-03-01'))?.price).toBe('52000');
  });

  it('does not mutate the candidate list', () => {
    const candidates = [ORG('48000', '2026-01-01'), ORG('52000', '2026-02-01')];
    const snapshot = JSON.stringify(candidates);
    selectEffectivePrice(candidates, ON('2026-03-01'));
    expect(JSON.stringify(candidates)).toBe(snapshot);
  });
});
