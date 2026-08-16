/**
 * The signature block's vocabulary, safe for the browser.
 *
 * Free of `server-only` and of any database import: the editor is a client
 * component, and reading these from the service would drag Drizzle into the
 * browser bundle.
 */

export type SignatorySlot = 'PREPARED_BY' | 'CHECKED_BY' | 'APPROVED_BY';

/** Printing order, left to right across the foot of the sheet. */
export const SIGNATORY_SLOTS: SignatorySlot[] = ['PREPARED_BY', 'CHECKED_BY', 'APPROVED_BY'];

export const SIGNATORY_SLOT_LABELS: Record<SignatorySlot, string> = {
  PREPARED_BY: 'Disusun oleh',
  CHECKED_BY: 'Diperiksa oleh',
  APPROVED_BY: 'Disetujui oleh',
};

/** Suggestions, not a closed list — every project titles its people differently. */
export const COMMON_POSITIONS = [
  'Project Manager',
  'Site Engineer',
  'Site Manager',
  'Pelaksana Lapangan',
  'Quantity Surveyor',
  'Konsultan Pengawas',
  'Owner / Pemberi Kerja',
];
