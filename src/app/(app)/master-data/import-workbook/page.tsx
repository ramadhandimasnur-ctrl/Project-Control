import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ButtonLink } from '@/components/ui/button';
import { assertOrgAccess } from '@/services/org-access';
import { requireSessionUser } from '@/services/session';

import { WorkbookImportForm } from './workbook-import-form';

export const metadata: Metadata = { title: 'Impor workbook' };

/*
 * A workbook of a few thousand rows takes the better part of a minute to read,
 * write and verify. The platform default would cut that off partway and leave
 * the user with no report and no idea whether anything was saved.
 */
export const maxDuration = 300;

export default async function WorkbookImportPage() {
  const user = await requireSessionUser();
  const access = await assertOrgAccess(user.id);

  // The service refuses a non-administrator anyway; hiding the page keeps a
  // dead end out of the navigation.
  if (access.globalRole !== 'ADMIN') notFound();

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-6">
      <ButtonLink variant="ghost" size="sm" href="/master-data" className="-ml-2">
        <ArrowLeft className="size-4" aria-hidden />
        Kembali ke master data
      </ButtonLink>

      <PageHeader
        title="Impor workbook PROJECT_CONTROL"
        description="Memindahkan isi workbook Excel ke aplikasi ini: satuan, sumber daya, pemasok, mandor, proyek, harga, WBS, item pekerjaan beserta AHSP-nya, periode, jadwal, rencana per periode, dan progres."
      />

      <Alert>
        <AlertTitle>Impor ini bisa diulang</AlertTitle>
        <AlertDescription>
          Setiap baris yang masuk dicatat asalnya — kode PRJ-0048 di workbook dipasangkan dengan
          proyek yang sama di sini selamanya. Jadi memperbaiki workbook lalu mengimpornya ulang
          memperbarui data yang sama, bukan menggandakannya. Proyek yang sudah ada dan belum pernah
          diimpor dikenali dari kode proyeknya.
        </AlertDescription>
      </Alert>

      <WorkbookImportForm />
    </div>
  );
}
