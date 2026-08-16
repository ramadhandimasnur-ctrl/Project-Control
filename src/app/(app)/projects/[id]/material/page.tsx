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
import { MaterialSimulator } from '@/features/purchases/material-simulator';
import { MATERIAL_STATUS_LABELS, type MaterialStatus } from '@/lib/calc/material';
import { EMPTY_VALUE, formatCurrency, formatPercent, formatQuantity } from '@/lib/format';
import { listPaymentTerms } from '@/services/cash';
import { getMaterialRequirement, getMaterialScope } from '@/services/material-requirement';
import { requireSessionUser } from '@/services/session';

export const metadata: Metadata = { title: 'Kebutuhan Material' };

const STATUS_VARIANT: Record<MaterialStatus, 'default' | 'secondary' | 'destructive'> = {
  GREEN: 'secondary',
  YELLOW: 'default',
  RED: 'destructive',
};

export default async function MaterialPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ target?: string }>;
}) {
  const [{ id: projectId }, query] = await Promise.all([params, searchParams]);
  const user = await requireSessionUser();

  const [requirement, terms] = await Promise.all([
    getMaterialRequirement(user.id, projectId),
    // Terms are commercial data; a role without cost access simply gets none,
    // and the simulator falls back to typing a percentage.
    listPaymentTerms(user.id, projectId).catch(() => []),
  ]);

  const { rows, totals, showCosts } = requirement;

  const parsedTarget = Number(query.target);
  const explicitTarget =
    Number.isFinite(parsedTarget) && query.target !== undefined
      ? String(Math.min(Math.max(parsedTarget, 0), 100) / 100)
      : null;

  const scope = await getMaterialScope(user.id, projectId, explicitTarget);
  const currentPct = Number(scope.currentWeight) * 100;
  const targetPct = Number(scope.targetWeight) * 100;

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
            The purchasing question, as opposed to the whole-project one below:
            what has to be on site to reach the next target, net of what is
            already in the store.
          */}
          <section className="space-y-3 rounded-lg border p-4">
            <div>
              <h2 className="text-sm font-semibold">Simulasi kebutuhan per target</h2>
              <p className="text-xs text-muted-foreground">
                Pilih termin atau ketik target bobot progres. Daftar di bawah adalah material yang
                harus disediakan untuk sampai ke sana, sudah dikurangi stok yang ada. Hanya sumber
                daya berjenis material — upah dan alat adalah biaya, bukan barang yang dipesan.
              </p>
            </div>

            <MaterialSimulator
              projectId={projectId}
              currentTarget={targetPct}
              currentWeight={currentPct}
              terms={terms.map((term) => ({
                id: term.id,
                label: `${term.name} — pemicu ${formatPercent(term.triggerProgressPct ?? 0, 0)}`,
                triggerProgressPct: term.triggerProgressPct ?? '0',
              }))}
            />

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Figure label="Progres sekarang" value={formatPercent(scope.currentWeight, 2)} />
              <Figure label="Target" value={formatPercent(scope.targetWeight, 2)} />
              <Figure label="Kekurangan" value={formatPercent(scope.gap, 2)} />
              <Figure
                label="Estimasi biaya material"
                value={scope.showCosts ? formatCurrency(scope.totalCost) : EMPTY_VALUE}
                caption={`${scope.rows.length} jenis material`}
              />
            </div>

            {!scope.achievable ? (
              <Alert variant="destructive">
                <Info className="size-4" aria-hidden />
                <AlertTitle>Target ini tidak tercapai oleh daftar pekerjaan yang ada</AlertTitle>
                <AlertDescription>
                  Periksa apakah masih ada pekerjaan yang belum masuk daftar, atau ada yang tidak
                  diikutkan dalam bobot progres.
                </AlertDescription>
              </Alert>
            ) : null}

            {scope.unpriced.length > 0 ? (
              <Alert>
                <Info className="size-4" aria-hidden />
                <AlertTitle>
                  {scope.unpriced.length} material belum punya harga RAP
                </AlertTitle>
                <AlertDescription>
                  Kuantitasnya tetap dihitung, tetapi estimasi biaya di atas belum memuatnya:{' '}
                  {scope.unpriced.slice(0, 6).map((row) => row.resourceName).join(', ')}
                  {scope.unpriced.length > 6 ? `, dan ${scope.unpriced.length - 6} lainnya` : ''}.
                </AlertDescription>
              </Alert>
            ) : null}

            {scope.rows.length === 0 ? (
              <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                Target ini sudah tercapai oleh progres yang disetujui — tidak ada material tambahan
                yang perlu disediakan.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-24">Kode</TableHead>
                      <TableHead>Material</TableHead>
                      <TableHead className="w-16">Sat</TableHead>
                      <TableHead className="w-28 text-right">Kebutuhan</TableHead>
                      <TableHead className="w-28 text-right">Stok</TableHead>
                      <TableHead className="w-28 text-right">Perlu dibeli</TableHead>
                      {scope.showCosts ? (
                        <TableHead className="w-32 text-right">Harga RAP</TableHead>
                      ) : null}
                      {scope.showCosts ? (
                        <TableHead className="w-36 text-right">Estimasi biaya</TableHead>
                      ) : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {scope.rows.map((row) => (
                      <TableRow key={row.resourceCode}>
                        <TableCell className="font-mono text-xs">{row.resourceCode}</TableCell>
                        <TableCell>{row.resourceName}</TableCell>
                        <TableCell className="text-muted-foreground">{row.unitCode}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                          {formatQuantity(row.required)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                          {formatQuantity(row.stock)}
                        </TableCell>
                        <TableCell className="text-right font-mono font-medium tabular-nums">
                          {formatQuantity(row.toBuy)}
                        </TableCell>
                        {scope.showCosts ? (
                          <TableCell className="text-right font-mono tabular-nums">
                            {row.priceRap === null ? (
                              <span className="text-destructive">{EMPTY_VALUE}</span>
                            ) : (
                              formatCurrency(row.priceRap)
                            )}
                          </TableCell>
                        ) : null}
                        {scope.showCosts ? (
                          <TableCell className="text-right font-mono tabular-nums">
                            {row.cost === null ? (
                              <span className="text-destructive">{EMPTY_VALUE}</span>
                            ) : (
                              formatCurrency(row.cost)
                            )}
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {scope.workItems.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                Dihitung dari {scope.workItems.length} pekerjaan menurut urutan rencana:{' '}
                {scope.workItems.slice(0, 6).map((item) => item.code).join(', ')}
                {scope.workItems.length > 6
                  ? `, dan ${scope.workItems.length - 6} lainnya`
                  : ''}
                .
              </p>
            ) : null}
          </section>

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

/** Pre-formatted, unlike `Kpi` which formats currency itself. */
function Figure({ label, value, caption }: { label: string; value: string; caption?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-mono text-base font-semibold tabular-nums">{value}</p>
      {caption ? <p className="text-xs text-muted-foreground">{caption}</p> : null}
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
