/**
 * Account vocabulary, safe for the browser.
 *
 * Deliberately free of `server-only` and of any database import. The user
 * management table is a client component, and reading these from the service
 * would drag Drizzle and the connection pool into the browser bundle — the
 * build fails, which is the good outcome; the bad one would be shipping it.
 */

export type UserStatus = 'PENDING' | 'ACTIVE' | 'REJECTED' | 'DEACTIVATED' | 'REMOVED';

export const USER_STATUS_LABELS: Record<UserStatus, string> = {
  PENDING: 'Menunggu persetujuan',
  ACTIVE: 'Aktif',
  REJECTED: 'Ditolak',
  DEACTIVATED: 'Dinonaktifkan',
  REMOVED: 'Dikeluarkan',
};

export type UserRow = {
  id: string;
  email: string;
  fullName: string;
  username: string | null;
  globalRole: 'ADMIN' | 'MEMBER';
  status: UserStatus;
  createdAt: string;
  reviewedAt: string | null;
};
