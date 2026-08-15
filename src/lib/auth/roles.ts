/**
 * Role model — pure, so it can be unit tested without a database and reused
 * identically by services, route handlers and the UI.
 *
 * Hiding a button is not security (charter rule 7). These predicates decide,
 * the server enforces, and the UI merely reflects the same answer.
 */

export const PROJECT_ROLES = [
  'ADMIN',
  'PROJECT_MANAGER',
  'ENGINEER',
  'FIELD_USER',
  'VIEWER',
] as const;

export type ProjectRole = (typeof PROJECT_ROLES)[number];
export type GlobalRole = 'ADMIN' | 'MEMBER';

/**
 * Ordering by breadth of authority. It is a genuine ladder for write scope:
 * a VIEWER reads, a FIELD_USER additionally records site data, an ENGINEER
 * additionally edits the estimate and schedule, a PROJECT_MANAGER additionally
 * approves and moves money.
 */
const RANK: Record<ProjectRole, number> = {
  VIEWER: 1,
  FIELD_USER: 2,
  ENGINEER: 3,
  PROJECT_MANAGER: 4,
  ADMIN: 5,
};

export function rankOf(role: ProjectRole): number {
  return RANK[role];
}

export function hasAtLeast(role: ProjectRole, minimum: ProjectRole): boolean {
  return RANK[role] >= RANK[minimum];
}

export function isProjectRole(value: string): value is ProjectRole {
  return (PROJECT_ROLES as readonly string[]).includes(value);
}

/**
 * Capabilities that are *not* a simple rank comparison are named explicitly,
 * so the intent survives future changes to the ladder.
 */

/** Estimate, work breakdown, schedule, material and purchasing edits. */
export function canEditProjectData(role: ProjectRole): boolean {
  return hasAtLeast(role, 'ENGINEER');
}

/** Recording site progress, material movements, photos and checklists. */
export function canRecordFieldData(role: ProjectRole): boolean {
  return hasAtLeast(role, 'FIELD_USER');
}

/** An ENGINEER may submit progress but must not approve their own work. */
export function canApproveProgress(role: ProjectRole): boolean {
  return hasAtLeast(role, 'PROJECT_MANAGER');
}

/** Contract value and payment terms are commercial, not engineering, data. */
export function canEditContractTerms(role: ProjectRole): boolean {
  return hasAtLeast(role, 'PROJECT_MANAGER');
}

export function canDeleteProject(role: ProjectRole): boolean {
  return hasAtLeast(role, 'PROJECT_MANAGER');
}

export function canManageMembers(role: ProjectRole): boolean {
  return hasAtLeast(role, 'PROJECT_MANAGER');
}

/**
 * Whether prices, costs and margin may be sent to this user *at all*.
 *
 * FIELD_USER is the one role that never sees commercial figures, and the
 * columns are stripped server-side before serialisation — not hidden with CSS.
 */
export function canViewCosts(role: ProjectRole): boolean {
  return role !== 'FIELD_USER';
}

export const PROJECT_ROLE_LABELS: Record<ProjectRole, string> = {
  ADMIN: 'Administrator',
  PROJECT_MANAGER: 'Manajer Proyek',
  ENGINEER: 'Engineer',
  FIELD_USER: 'Petugas Lapangan',
  VIEWER: 'Peninjau',
};

export const PROJECT_ROLE_DESCRIPTIONS: Record<ProjectRole, string> = {
  ADMIN: 'Akses penuh ke seluruh proyek, master data, dan pengguna organisasi.',
  PROJECT_MANAGER:
    'Seluruh kewenangan di proyek ini, termasuk menyetujui progres, mengubah nilai kontrak, dan termin.',
  ENGINEER:
    'Menyusun estimasi, jadwal, dan pembelian. Tidak dapat menyetujui progres atau mengubah nilai kontrak.',
  FIELD_USER:
    'Mencatat progres, mutasi material, foto, dan ceklis mutu. Tidak melihat harga maupun margin.',
  VIEWER: 'Hanya membaca dashboard dan laporan.',
};
