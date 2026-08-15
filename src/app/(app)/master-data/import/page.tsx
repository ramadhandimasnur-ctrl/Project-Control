import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { assertOrgAccess } from '@/services/org-access';
import { requireSessionUser } from '@/services/session';

import { ImportForm } from './import-form';

export const metadata: Metadata = { title: 'Impor Excel' };

export default async function ImportPage() {
  const user = await requireSessionUser();
  const access = await assertOrgAccess(user.id);

  // The service refuses a non-administrator anyway; hiding the page keeps a
  // dead end out of the navigation.
  if (access.globalRole !== 'ADMIN') notFound();

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-6">
      <Button
        variant="ghost"
        size="sm"
        render={<Link href="/master-data/resources" />}
        className="-ml-2"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Kembali ke katalog
      </Button>

      <PageHeader
        title="Impor daftar sumber daya"
        description="Membaca sheet UTBA dari workbook analisa. Impor dicocokkan berdasarkan kode, sehingga mengunggah berkas yang sudah dikoreksi memperbarui data lama, bukan menggandakannya."
      />

      <ImportForm />
    </div>
  );
}
