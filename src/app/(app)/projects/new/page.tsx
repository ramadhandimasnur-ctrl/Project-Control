import type { Metadata } from 'next';

import { PageHeader } from '@/components/page-header';
import { requireSessionUser } from '@/services/session';

import { NewProjectForm } from './new-project-form';

export const metadata: Metadata = { title: 'Proyek Baru' };

export default async function NewProjectPage() {
  await requireSessionUser();

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-6">
      <PageHeader
        title="Proyek baru"
        description="Isi informasi kontrak dan aturan pengendalian. Semua pengaturan ini masih dapat diubah nanti."
      />
      <NewProjectForm />
    </div>
  );
}
