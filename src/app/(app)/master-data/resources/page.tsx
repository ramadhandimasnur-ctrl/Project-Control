import { FileSpreadsheet, PackageSearch } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { ResourceCreateButton } from '@/features/master-data/resource-create-button';
import { assertOrgAccess } from '@/services/org-access';
import { listUnits } from '@/services/units';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EMPTY_VALUE, formatCurrency } from '@/lib/format';
import { listCategories } from '@/services/resource-categories';
import { listResources, type ResourceType } from '@/services/resources';
import { requireSessionUser } from '@/services/session';

import { ResourceFilters } from './resource-filters';
import { ResourcePagination } from './resource-pagination';

export const metadata: Metadata = { title: 'Sumber Daya' };

const TYPE_LABELS: Record<ResourceType, string> = {
  LABOR: 'Tenaga',
  MATERIAL: 'Material',
  EQUIPMENT: 'Alat',
  SUBCON: 'Subkon',
  PACKAGE: 'Paket',
  OVERHEAD: 'Operasional',
};

const PAGE_SIZE = 50;

function parseType(value: string | undefined): ResourceType | undefined {
  if (!value) return undefined;
  return value in TYPE_LABELS ? (value as ResourceType) : undefined;
}

export default async function ResourcesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; category?: string; page?: string }>;
}) {
  const params = await searchParams;
  const user = await requireSessionUser();

  const page = Math.max(Number(params.page ?? '1') || 1, 1);
  const search = params.q?.trim() ?? '';
  const type = parseType(params.type);

  const [{ items, total, showCosts }, categories, units, access] = await Promise.all([
    listResources(user.id, {
      search: search === '' ? undefined : search,
      ...(type ? { type } : {}),
      ...(params.category ? { categoryId: params.category } : {}),
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    listCategories(user.id),
    listUnits(user.id),
    assertOrgAccess(user.id),
  ]);

  const canManage = access.globalRole === 'ADMIN';

  const filtered = search !== '' || type !== undefined || params.category !== undefined;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Sumber Daya"
        description={`${total.toLocaleString('id-ID')} item dalam katalog organisasi.`}
        actions={
          canManage ? (
            <>
              <ButtonLink variant="outline" href="/master-data/import">
                <FileSpreadsheet className="size-4" aria-hidden />
                Impor Excel
              </ButtonLink>
              <ResourceCreateButton
                units={units.map((u) => ({ id: u.id, code: u.code, name: u.name }))}
                categories={categories.map((c) => ({ id: c.id, name: c.name }))}
                canManage={canManage}
              />
            </>
          ) : null
        }
      />

      <ResourceFilters
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        typeLabels={TYPE_LABELS}
      />

      {items.length === 0 ? (
        <EmptyState
          icon={PackageSearch}
          title={filtered ? 'Tidak ada yang cocok' : 'Katalog masih kosong'}
          description={
            filtered
              ? 'Ubah kata kunci atau saring dengan jenis dan kategori lain.'
              : 'Impor daftar sumber daya dari file Excel UTBA, atau tambahkan satu per satu.'
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Kode</TableHead>
                  <TableHead>Uraian</TableHead>
                  <TableHead className="w-20">Satuan</TableHead>
                  <TableHead className="w-28">Jenis</TableHead>
                  <TableHead>Kategori</TableHead>
                  {showCosts ? <TableHead className="w-36 text-right">Harga RAB</TableHead> : null}
                  {showCosts ? <TableHead className="w-36 text-right">Harga RAP</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-xs">
                      <Link href={`/master-data/resources/${item.id}`} className="hover:underline">
                        {item.code}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/master-data/resources/${item.id}`}
                        className="font-medium hover:underline"
                      >
                        {item.name}
                      </Link>
                      {item.spec ? (
                        <span className="block text-xs text-muted-foreground">{item.spec}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{item.unitCode}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-[10px]">
                        {TYPE_LABELS[item.type]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {item.categoryName ?? EMPTY_VALUE}
                    </TableCell>
                    {showCosts ? (
                      <TableCell className="text-right font-mono tabular-nums">
                        {item.priceRab === null ? (
                          <span className="text-muted-foreground">{EMPTY_VALUE}</span>
                        ) : (
                          formatCurrency(item.priceRab)
                        )}
                      </TableCell>
                    ) : null}
                    {showCosts ? (
                      <TableCell className="text-right font-mono tabular-nums">
                        {item.priceRap === null ? (
                          <span className="text-muted-foreground">{EMPTY_VALUE}</span>
                        ) : (
                          formatCurrency(item.priceRap)
                        )}
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <ResourcePagination page={page} pageSize={PAGE_SIZE} total={total} />
        </>
      )}
    </div>
  );
}
