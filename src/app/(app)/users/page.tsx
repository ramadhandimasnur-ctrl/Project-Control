import { Info, ShieldAlert } from 'lucide-react';
import type { Metadata } from 'next';

import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { UsersManager } from '@/features/users/users-manager';
import { emailIsConfigured, notifyAddress } from '@/lib/notify/email';
import { isAppError } from '@/lib/errors';
import { requireSessionUser } from '@/services/session';
import { listUsers } from '@/services/users';

export const metadata: Metadata = { title: 'Pengguna' };

/**
 * Account administration.
 *
 * The gate is `listUsers`, which requires the organisation ADMIN role — the
 * page does not decide access for itself, so a future route that forgets to
 * check cannot leak the list.
 */
export default async function UsersPage() {
  const user = await requireSessionUser();

  const users = await listUsers(user.id).catch((error: unknown) => {
    if (isAppError(error) && (error.code === 'FORBIDDEN' || error.code === 'UNAUTHENTICATED')) {
      return null;
    }
    throw error;
  });

  if (users === null) {
    return (
      <div className="space-y-6 p-6">
        <EmptyState
          icon={ShieldAlert}
          title="Halaman ini untuk administrator"
          description="Hanya administrator organisasi yang dapat menyetujui pendaftaran dan mengatur peran."
        />
      </div>
    );
  }

  const address = notifyAddress();

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Pengguna"
        description="Pendaftaran baru masuk sebagai menunggu persetujuan dan tidak dapat masuk sampai disetujui beserta perannya."
      />

      {/*
        Said plainly rather than assumed. An administrator who believes an email
        is on its way, when the deployment has no mail provider configured, will
        not think to check this page — which is exactly when a new colleague
        waits a week for access.
      */}
      {emailIsConfigured() ? (
        <Alert>
          <Info className="size-4" aria-hidden />
          <AlertTitle>Notifikasi email aktif</AlertTitle>
          <AlertDescription>
            Pendaftaran baru dikirimkan ke {address}. Daftar di bawah tetap menjadi catatan
            utamanya.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert>
          <Info className="size-4" aria-hidden />
          <AlertTitle>Notifikasi email belum dikonfigurasi</AlertTitle>
          <AlertDescription>
            Pendaftaran tetap tercatat dan muncul di daftar ini, tetapi tidak ada email yang
            dikirim. Isi <code className="font-mono text-xs">RESEND_API_KEY</code>,{' '}
            <code className="font-mono text-xs">NOTIFY_EMAIL_FROM</code>, dan{' '}
            <code className="font-mono text-xs">NOTIFY_EMAIL_TO</code> pada berkas environment
            untuk mengaktifkannya.
          </AlertDescription>
        </Alert>
      )}

      <UsersManager users={users} currentUserId={user.id} />
    </div>
  );
}
