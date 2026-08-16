import { describe, expect, it } from 'vitest';

import { applyPriceEdit, markupFromRab, rabFromMarkup } from '../markup';

const triple = (rap: string, rab: string, markup: string) => ({ rap, rab, markup });

describe('rabFromMarkup', () => {
  it('adds the percentage to the execution cost', () => {
    expect(rabFromMarkup('48000', '15')).toBe('55200');
  });

  it('treats zero markup as billing at cost', () => {
    expect(rabFromMarkup('48000', '0')).toBe('48000');
  });
});

describe('markupFromRab', () => {
  it('reports the percentage implied by a typed budget', () => {
    expect(markupFromRab('48000', '55200')).toBe('15');
  });

  /*
   * No percentage turns nothing into something, and writing Infinity into the
   * field is worse than leaving the old value alone.
   */
  it('refuses to divide by a zero cost', () => {
    expect(markupFromRab('0', '55200')).toBeNull();
  });
});

describe('applyPriceEdit', () => {
  it('derives RAB when the markup is edited', () => {
    const { next, mode } = applyPriceEdit(triple('48000', '', ''), 'markup', '15', 'rab');
    expect(next.rab).toBe('55200');
    expect(next.rap).toBe('48000');
    expect(mode).toBe('markup');
  });

  it('derives the markup when RAB is edited', () => {
    const { next, mode } = applyPriceEdit(triple('48000', '', ''), 'rab', '55200', 'markup');
    expect(next.markup).toBe('15');
    expect(next.rap).toBe('48000');
    expect(mode).toBe('rab');
  });

  /*
   * The whole point of remembering the mode: a user who set a 15% policy
   * expects the budget to follow the cost, while a user who typed a negotiated
   * budget expects that figure to stand and the percentage to re-report itself.
   */
  it('moves RAB with RAP while the markup is the policy', () => {
    const { next } = applyPriceEdit(triple('48000', '55200', '15'), 'rap', '50000', 'markup');
    expect(next.rab).toBe('57500');
    expect(next.markup).toBe('15');
  });

  it('recomputes the markup with RAP while RAB is the fixed figure', () => {
    const { next } = applyPriceEdit(triple('48000', '55200', '15'), 'rap', '46000', 'rab');
    expect(next.rab).toBe('55200');
    expect(next.markup).toBe('20');
  });

  /*
   * Typing "4" on the way to "48000" must not wipe the neighbouring field the
   * user already filled in.
   */
  it('leaves neighbours alone while a field is half typed', () => {
    const { next } = applyPriceEdit(triple('48000', '55200', '15'), 'markup', '', 'markup');
    expect(next.rab).toBe('55200');

    const partial = applyPriceEdit(triple('48000', '55200', '15'), 'rap', '', 'markup');
    expect(partial.next.rab).toBe('55200');
  });

  it('never rewrites RAP from the other two', () => {
    const fromMarkup = applyPriceEdit(triple('48000', '55200', '15'), 'markup', '30', 'markup');
    expect(fromMarkup.next.rap).toBe('48000');

    const fromRab = applyPriceEdit(triple('48000', '55200', '15'), 'rab', '60000', 'rab');
    expect(fromRab.next.rap).toBe('48000');
  });
});
