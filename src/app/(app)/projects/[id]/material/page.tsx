import { Boxes, Info, PackageSearch, Warehouse } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { MATERIAL_STATUS_LABELS, type MaterialStatus } from '@/lib/calc/material';
import { EMPTY_VALUE, formatCurrency, formatPercent, formatQuantity } from '@/lib/format';
import { getMaterialRequirement } from '@/services/material-requirement';
import { requireSessionUser } from '@/services/session';

export const metadata: Metadata = { title: 'Kebutuhan Material' };

const STATUS_VARIANT: Record<MaterialStatus, 'default' | 'secondary' | 'destructive'> = {
  GREEN: 'secondary',
  YELLOW: 'default',
  RED: 'destructive',
};

export default async function MaterialPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const user = await requireSessionUser();
  const requirement = await getMaterialRequirement(user.id, projectId);

  const { rows, totals, showCosts } = requirement;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Kebutuhan Material"
        description="Kebutuhan diturunkan dari koefisien RAP setiap pekerjaan, bukan diketik ulang."
        actions={
          <>
            <ButtonLink variant="outline" href={`/projects/${projectId}/warehouse`}>
              <Warehouse className="size-4" aria-hidden />
              Gudang
            </ButtonLink>
            <ButtonLink href={`/projects/${projectId}/purchases`}>
              <Boxes className="size-4" aria-hidden />
              Pembelian
            </ButtonLink>
          </>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={PackageSearch}
          title="Belum ada kebutuhan material"
          description="Kebutuhan terbentuk dari analisa harga satuan. Susun AHSP pekerjaan terlebih dahulu."
          action={
            <ButtonLink href={`/projects/${projectId}/work-items`}>
              Buka Pekerjaan &amp; AHSP
            </ButtonLink>
          }
        />
      ) : (
        <>
          {/*
            Wastage compares what left the store against what the approved
            progress justifies. Progress arrives in Phase 6, so until then the
            comparison has nothing to stand on and the column would read as if
            every issue were waste.
          */}
          <Alert>
            <Info className="size-4" aria-hidden />
            <AlertTitle>Pemborosan belum dapat dihitung</AlertTitle>
            <AlertDescription>
              Pemborosan adalah selisih antara material yang keluar gudang dan yang seharusnya
              terpakai menurut progres yang disetujui. Pencatatan progres hadir pada Fase 6; sampai
              saat itu kolom pemakaian teoretis bernilai nol, sehingga selisihnya belum bermakna.
            </AlertDescription>
          </Alert>

          {showCosts ? (
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi label="Nilai stok" value={totals.stockValue} />
              <Kpi label="Estimasi pembelian tersisa" value={totals.purchaseValueRemaining} />
              <Kpi label="Item kurang beli" value={String(totals.shortageCount)} plain />
              <Kpi label="Jenis material" value={String(rows.length)} plain />
            </dl>
          ) : null}

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Kode</TableHead>
                  <TableHead>Uraian</TableHead>
                  <TableHead className="w-14">Sat</TableHead>
                  <TableHead className="w-28 text-right">Kebutuhan</TableHead>
                  <TableHead className="w-24 text-right">Dibeli</TableHead>
                  <TableHead className="w-24 text-right">Keluar</TableHead>
                  <TableHead className="w-28 text-right">Teoretis</TableHead>
                  <TableHead className="w-28 text-right">Pemborosan</TableHead>
                  <TableHead className="w-24 text-right">Stok</TableHead>
                  <TableHead className="w-28 text-right">Kurang</TableHead>
                  {showCosts ? <TableHead className="w-32 text-right">Nilai stok</TableHead> : null}
                  <TableHead className="w-28">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.resourceId}>
                    <TableCell className="font-mono text-xs">
                      <Link
                        href={`/master-data/resources/${row.resourceId}`}
                        className="hover:underline"
                      >
                        {row.resourceCode}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {row.resourceName}
                      {row.resourceSpec ? (
                        <span className="block text-xs text-muted-foreground">
                          {row.resourceSpec}
                        </span>
                      ) : null}
                      <span className="block text-xs text-muted-foreground">
                        dipakai di {row.workItemCount} pekerjaan
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{row.unitCode}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatQuantity(row.requirementTotal)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatQuantity(row.purchased)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatQuantity(row.issued)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                      {formatQuantity(row.theoreticalUsage)}
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono tabular-nums ${
                        Number(row.wastage) > 0 ? 'text-destructive' : 'text-muted-foreground'
                      }`}
                    >
                      {formatQuantity(row.wastage)}
                      {row.wastagePercent === null ? null : (
                        <span className="block text-xs">{formatPercent(row.wastagePercent, 1)}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatQuantity(row.stock)}
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono tabular-nums ${
                        Number(row.shortage) > 0 ? 'font-medium text-destructive' : ''
                      }`}
                    >
                      {formatQuantity(row.shortage)}
                    </TableCell>
                    {showCosts ? (
                      <TableCell className="text-right font-mono tabular-nums">
                        {row.stockValue === null ? EMPTY_VALUE : formatCurrency(row.stockValue)}
                      </TableCell>
                    ) : null}
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[row.status]} className="text-[10px]">
                        {MATERIAL_STATUS_LABELS[row.status]}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
            <p>
              <strong>Kurang beli</strong> — total pembelian belum menutupi kebutuhan rencana.
            </p>
            <p>
              <strong>Perlu dipesan</strong> — sudah dibeli cukup, tetapi belum ada di gudang.
            </p>
            <p>
              <strong>Aman</strong> — kebutuhan dan stok keduanya tercukupi.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, plain }: { label: string; value: string | null; plain?: boolean }) {
  return (
    <div className="rounded-lg border p-4">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-mono text-xl font-semibold tabular-nums">
        {value === null ? EMPTY_VALUE : plain ? value : formatCurrency(value)}
      </dd>
    </div>
  );
}
