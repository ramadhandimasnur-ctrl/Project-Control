/**
 * Progress-entry vocabulary, safe for the browser.
 *
 * Free of `server-only` and of any database import: the progress board is a
 * client component. Previously this table lived in two places — the board and
 * the opname sheet — and adding a status to one meant remembering the other.
 */

export type ProgressEntryStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED';

export const PROGRESS_ENTRY_STATUS_LABELS: Record<ProgressEntryStatus, string> = {
  DRAFT: 'Draf',
  SUBMITTED: 'Diajukan',
  APPROVED: 'Disetujui',
  REJECTED: 'Ditolak',
  CANCELLED: 'Dibatalkan',
};

export const PROGRESS_ENTRY_STATUS_VARIANTS: Record<
  ProgressEntryStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  DRAFT: 'outline',
  SUBMITTED: 'default',
  APPROVED: 'secondary',
  REJECTED: 'destructive',
  // Muted rather than red: a withdrawn entry is not a failure, it is a row
  // that no longer claims anything.
  CANCELLED: 'outline',
};

/**
 * Whether a recorder may still correct the entry in place.
 *
 * Mirrors the rule the service enforces. Kept here so the board can hide a
 * control the server would refuse, rather than offering it and reporting an
 * error after the click.
 */
export function isEditableProgressStatus(status: ProgressEntryStatus | null): boolean {
  return status === null || status === 'DRAFT' || status === 'REJECTED' || status === 'CANCELLED';
}
