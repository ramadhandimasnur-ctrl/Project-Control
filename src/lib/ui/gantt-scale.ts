/**
 * How wide the Gantt canvas has to be, and how often to label its axis.
 *
 * The bar geometry in lib/calc/schedule was never the problem: a four-day task
 * inside a 123-day project really is 3,25% of the timeline. It only *looked*
 * broken because 123 daily columns were squeezed into one screen, leaving every
 * bar a seventeen-pixel sliver bunched at the left edge.
 *
 * So the canvas is given a width proportional to the number of periods and
 * allowed to scroll, and the axis is labelled sparsely enough that the labels
 * stay readable instead of overlapping into a grey smear.
 */

export type PeriodType = 'DAY' | 'WEEK' | 'MONTH';

/**
 * Pixels per period, by bucket size.
 *
 * Daily buckets get the least room each — there are simply many more of them —
 * but still enough that a one-day task is a visible block rather than a line.
 */
const PX_PER_PERIOD: Record<PeriodType, number> = {
  DAY: 26,
  WEEK: 64,
  MONTH: 104,
};

/** Room a date label needs before its neighbour starts touching it. */
const LABEL_PX = 76;

/** Below this the chart stops looking like a chart. */
const MIN_TRACK_PX = 640;

export type GanttScale = {
  /** Width of the time track, excluding the frozen label column. */
  trackWidthPx: number;
  /** Label every nth period; 1 means every one. */
  labelStride: number;
};

export function ganttScale(periodCount: number, periodType: PeriodType): GanttScale {
  if (periodCount <= 0) return { trackWidthPx: MIN_TRACK_PX, labelStride: 1 };

  const perPeriod = PX_PER_PERIOD[periodType];
  const trackWidthPx = Math.max(MIN_TRACK_PX, periodCount * perPeriod);

  // Labels are spaced by actual rendered width, not by period count, so a
  // stretched track shows more of them rather than the same few.
  const renderedPerPeriod = trackWidthPx / periodCount;
  const labelStride = Math.max(1, Math.ceil(LABEL_PX / renderedPerPeriod));

  return { trackWidthPx, labelStride };
}

/** True when this period should carry a visible label. */
export function isLabelled(index: number, stride: number): boolean {
  return index % stride === 0;
}
