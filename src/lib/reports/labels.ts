/**
 * Names and vocabulary for the reporting module.
 *
 * Deliberately free of `server-only` and of any database import: the publish
 * dialog and the issue form are client components, and pulling these from the
 * service would drag the whole server module — Drizzle, the pool, the lot —
 * into the browser bundle. It fails the build, which is the good outcome; the
 * bad one would be shipping it.
 */

export type ReportType = 'DAILY' | 'WEEKLY' | 'MONTHLY';
export type IssueSeverity = 'LOW' | 'MEDIUM' | 'HIGH';
export type IssueStatus = 'OPEN' | 'IN_PROGRESS' | 'CLOSED';

export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  DAILY: 'Harian',
  WEEKLY: 'Mingguan',
  MONTHLY: 'Bulanan',
};

export const ISSUE_SEVERITY_LABELS: Record<IssueSeverity, string> = {
  LOW: 'Ringan',
  MEDIUM: 'Sedang',
  HIGH: 'Berat',
};

export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
  OPEN: 'Terbuka',
  IN_PROGRESS: 'Ditangani',
  CLOSED: 'Selesai',
};

/**
 * Column headings for the progress columns, worded for the project's own
 * period.
 *
 * A monthly project reading "Minggu lalu" invites the reader to halve the
 * figure in their head, so the wording follows the calendar the project
 * actually runs on.
 */
export const PROGRESS_COLUMN_LABELS: Record<
  'DAY' | 'WEEK' | 'MONTH',
  { previous: string; current: string; cumulative: string }
> = {
  DAY: { previous: 'Hari lalu', current: 'Hari ini', cumulative: 's.d. hari ini' },
  WEEK: { previous: 'Minggu lalu', current: 'Minggu ini', cumulative: 's.d. minggu ini' },
  MONTH: { previous: 'Bulan lalu', current: 'Bulan ini', cumulative: 's.d. bulan ini' },
};
