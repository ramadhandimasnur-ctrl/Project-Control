/**
 * Paper geometry for printed reports.
 *
 * `@page` is an at-rule, so a paper size cannot be set from an inline style the
 * way a colour can — the only way to make it configurable is to emit the rule
 * itself. This module produces that text and nothing else, which keeps it
 * testable and keeps the component that injects it trivial.
 *
 * Sizes are written out in millimetres rather than using the CSS keywords.
 * `A4` and `letter` have keywords; F4 — the folio size most Indonesian offices
 * actually stock — does not, and mixing keywords with explicit dimensions in
 * one control invites a bug the day someone adds another size.
 */

export type PaperId = 'A4' | 'F4' | 'LETTER' | 'LEGAL' | 'A3' | 'A5';
export type Orientation = 'PORTRAIT' | 'LANDSCAPE';
export type MarginId = 'NARROW' | 'NORMAL' | 'WIDE';

export type Paper = {
  id: PaperId;
  label: string;
  /** Portrait dimensions in millimetres. */
  widthMm: number;
  heightMm: number;
};

export const PAPERS: Paper[] = [
  { id: 'A4', label: 'A4 (210 × 297 mm)', widthMm: 210, heightMm: 297 },
  { id: 'F4', label: 'F4 / Folio (215 × 330 mm)', widthMm: 215, heightMm: 330 },
  { id: 'LETTER', label: 'Letter (216 × 279 mm)', widthMm: 216, heightMm: 279 },
  { id: 'LEGAL', label: 'Legal (216 × 356 mm)', widthMm: 216, heightMm: 356 },
  { id: 'A3', label: 'A3 (297 × 420 mm)', widthMm: 297, heightMm: 420 },
  { id: 'A5', label: 'A5 (148 × 210 mm)', widthMm: 148, heightMm: 210 },
];

export const ORIENTATION_LABELS: Record<Orientation, string> = {
  PORTRAIT: 'Tegak',
  LANDSCAPE: 'Mendatar',
};

export const MARGINS: Record<MarginId, { label: string; mm: number }> = {
  NARROW: { label: 'Sempit (10 mm)', mm: 10 },
  NORMAL: { label: 'Normal (14 mm)', mm: 14 },
  WIDE: { label: 'Lebar (20 mm)', mm: 20 },
};

export type PaperSetting = {
  paper: PaperId;
  orientation: Orientation;
  margin: MarginId;
};

export const DEFAULT_PAPER: PaperSetting = {
  paper: 'A4',
  orientation: 'PORTRAIT',
  margin: 'NORMAL',
};

export function paperById(id: PaperId): Paper {
  return PAPERS.find((paper) => paper.id === id) ?? PAPERS[0]!;
}

/** Sheet dimensions after orientation is applied. */
export function sheetSize(setting: PaperSetting): { widthMm: number; heightMm: number } {
  const paper = paperById(setting.paper);
  return setting.orientation === 'LANDSCAPE'
    ? { widthMm: paper.heightMm, heightMm: paper.widthMm }
    : { widthMm: paper.widthMm, heightMm: paper.heightMm };
}

/**
 * Width left for content once both margins are taken off.
 *
 * Used to size the on-screen preview, so what the user arranges is the width
 * they will actually get on paper rather than whatever the browser window
 * happens to be.
 */
export function contentWidthMm(setting: PaperSetting): number {
  const { widthMm } = sheetSize(setting);
  return Math.max(widthMm - MARGINS[setting.margin].mm * 2, 10);
}

/** The `@page` rule for this setting. */
export function pageRule(setting: PaperSetting): string {
  const { widthMm, heightMm } = sheetSize(setting);
  return `@page { size: ${widthMm}mm ${heightMm}mm; margin: ${MARGINS[setting.margin].mm}mm; }`;
}

/** Reads a stored setting, falling back to the default on anything unexpected. */
export function parsePaperSetting(raw: unknown): PaperSetting {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_PAPER;
  const value = raw as Partial<Record<keyof PaperSetting, unknown>>;

  const paper = PAPERS.some((p) => p.id === value.paper)
    ? (value.paper as PaperId)
    : DEFAULT_PAPER.paper;
  const orientation =
    value.orientation === 'LANDSCAPE' || value.orientation === 'PORTRAIT'
      ? value.orientation
      : DEFAULT_PAPER.orientation;
  const margin =
    value.margin === 'NARROW' || value.margin === 'NORMAL' || value.margin === 'WIDE'
      ? value.margin
      : DEFAULT_PAPER.margin;

  return { paper, orientation, margin };
}
