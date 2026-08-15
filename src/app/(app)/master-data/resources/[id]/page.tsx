import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ResourceDetailActions } from '@/features/master-data/resource-detail-actions';
import { isAppError } from '@/lib/errors';
import { EMPTY_VALUE, formatCurrency, formatDay } from '@/lib/format';
import { assertOrgAccess, canViewOrgCosts } from '@/services/org-access';
import { listPriceHistory } from '@/services/prices';
import { listCategories } from '@/services/resource-categories';
import { countResourceUsage, getResource } from '@/services/resources';
import { requireSessionUser } from '@/services/session';
import { listUnits } from '@/services/units';

export const metadata: Metadata = { title: 'Detail Sumber Daya' };

const TYPE_LABELS = {
  LABOR: 'Tenaga',
  MATERIAL: 'Material',
  EQUIPMENT: 'Alat',
  SUBCON: 'Subkon',
  PACKAGE: 'Paket',
  OVERHEAD: 'Operasional',
} as const;

export default async function ResourceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireSessionUser();

  const resource = await getResource(user.id, id).catch((error: unknown) => {
    if (isAppError(error) && error.code === 'NOT_FOUND') notFound();
    throw error;
  });

  const showCosts = await canViewOrgCosts(user.id);
  const [history, usage, units, categories, access] = await Promise.all([
    showCosts ? listPriceHistory(user.id, id) : Promise.resolve([]),
    countResourceUsage(id),
    listUnits(user.id),
    listCategories(user.id),
    assertOrgAccess(user.id),
  ]);

  const canManage = access.globalRole === 'ADMIN';

  const facts: { label: string; value: string }[] = [
    { label: 'Kode', value: resource.code },
    { label: 'Satuan', value: resource.unitCode },
    { label: 'Jenis', value: TYPE_LABELS[resource.type] },
    { label: 'Kategori', value: resource.categoryName ?? EMPTY_VALUE },
    { label: 'Spesifikasi', value: resource.spec ?? EMPTY_VALUE },
    { label: 'Keterangan', value: resource.notes ?? EMPTY_VALUE },
    { label: 'Lead time', value: `${resource.leadTimeDays} hari` },
    { label: 'Status', value: resource.isActive ? 'Aktif' : 'Nonaktif' },
  ];

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-6">
      <ButtonLink
        variant="ghost"
        size="sm"
        href="/master-data/resources"
        className="-ml-2"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Kembali ke daftar
      </ButtonLink>

      <PageHeader
        title={resource.name}
        description={resource.spec ?? undefined}
        actions={
          <>
            {resource.isActive ? null : <Badge variant="outline">Nonaktif</Badge>}
            <ResourceDetailActions
              resourceId={resource.id}
              resourceName={resource.name}
              unitCode={resource.unitCode}
              isActive={resource.isActive}
              defaultValues={{
                code: resource.code,
                name: resource.name,
                spec: resource.spec ?? '',
                type: resource.type,
                unitId: resource.unitId,
                categoryId: resource.categoryId ?? '',
                leadTimeDays: resource.leadTimeDays,
                notes: resource.notes ?? '',
              }}
              units={units.map((u) => ({ id: u.id, code: u.code, name: u.name }))}
              categories={categories.map((c) => ({ id: c.id, name: c.name }))}
              usage={usage}
              canManage={canManage}
              canManagePrices={canManage && showCosts}
            />
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Informasi</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
            {facts.map((fact) => (
              <div key={fact.label}>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  {fact.label}
                </dt>
                <dd className="mt-0.5 text-sm font-medium">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      {showCosts ? (
        <Card>
          <CardHeader>
            <CardTitle>Riwayat harga</CardTitle>
          </CardHeader>
          <CardContent>
            {history.length === 0 ? (
              <Alert>
                <AlertTitle>Belum ada harga</AlertTitle>
                <AlertDescription>
                  Sumber daya ini belum dapat dipakai dalam estimasi sampai harganya diisi.
                </AlertDescription>
              </Alert>
            ) : (
              <>
                {/* A price is never overwritten: every change is a new dated
                    row, so an old estimate can always be explained. */}
                <p className="mb-3 text-sm text-muted-foreground">
                  Harga tidak pernah ditimpa. Setiap perubahan menjadi baris baru dengan tanggal
                  berlakunya sendiri, sehingga estimasi lama tetap dapat ditelusuri.
                </p>
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-24">Jenis</TableHead>
                        <TableHead className="w-36">Berlaku sejak</TableHead>
                        <TableHead className="text-right">Harga</TableHead>
                        <TableHead>Cakupan</TableHead>
                        <TableHead>Sumber</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {history.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell>
                            <Badge variant="secondary" className="text-[10px]">
                              {row.priceType}
                            </Badge>
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {formatDay(row.effectiveFrom)}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {formatCurrency(row.price)}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {row.projectId === null ? 'Default organisasi' : 'Khusus proyek'}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {row.source ?? EMPTY_VALUE}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Dipakai di</CardTitle>
        </CardHeader>
        <CardContent>
          {usage.total === 0 ? (
            <p className="text-sm text-muted-foreground">
              Belum dipakai di mana pun, sehingga masih dapat dihapus.
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              <li>{usage.workItems} baris analisa pekerjaan</li>
              <li>{usage.ahspTemplates} baris template AHSP</li>
              <li>{usage.materialTransactions} transaksi material</li>
              <li>{usage.purchaseItems} baris pembelian</li>
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
