import { Library } from 'lucide-react';
import type { Metadata } from 'next';

import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { LibraryBrowser } from '@/features/master-data/ahsp-library-browser';
import { getLibraryEntry, listLibraryEntries } from '@/services/ahsp-library';
import { requireSessionUser } from '@/services/session';

export const metadata: Metadata = { title: 'Pustaka AHSP' };

const PAGE_SIZE = 40;

export default async function AhspLibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; entry?: string }>;
}) {
  const { q, page, entry } = await searchParams;
  const user = await requireSessionUser();

  const pageNumber = Math.max(Number(page ?? '1') || 1, 1);
  const { items, total } = await listLibraryEntries(user.id, {
    search: q,
    limit: PAGE_SIZE,
    offset: (pageNumber - 1) * PAGE_SIZE,
  });

  /*
   * The detail is fetched here rather than in a route of its own so that
   * choosing an analysis does not lose the search that found it. Matching
   * against the catalogue happens inside `getLibraryEntry`, so what the panel
   * shows is what applying the entry would actually write.
   */
  const selected = entry === undefined ? null : await getLibraryEntry(user.id, entry).catch(() => null);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Pustaka AHSP"
        description="Analisa terbitan resmi, disimpan apa adanya beserta sumbernya. Hanya koefisiennya yang diambil — harga tetap milik Anda."
      />

      {total === 0 && !q ? (
        <EmptyState
          icon={Library}
          title="Pustaka masih kosong"
          description="Impor pustaka AHSP dari workbook Excel dengan: npm run db:import:ahsp -- &quot;file.xlsm&quot; --email=... --apply"
        />
      ) : (
        <LibraryBrowser
          items={items}
          total={total}
          pageSize={PAGE_SIZE}
          pageNumber={pageNumber}
          search={q ?? ''}
          selected={selected}
        />
      )}
    </div>
  );
}
