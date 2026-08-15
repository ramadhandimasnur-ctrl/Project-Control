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
