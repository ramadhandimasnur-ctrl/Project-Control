import { Warehouse } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { sql } from 'drizzle-orm';

import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { MovementActions } from '@/features/purchases/movement-actions';
import { canEditProjectData, canRecordFieldData } from '@/lib/auth/roles';
import { EMPTY_VALUE, formatCurrency, formatDay, formatQuantity } from '@/lib/format';
import { withUser } from '@/db/context';
import { listMovements } from '@/services/material-transactions';
import { listResourcesInStock } from '@/services/material-requirement';
import { canViewOrgCosts } from '@/services/org-access';
import { getProject } from '@/services/projects';
import { requireSessionUser } from '@/services/session';
import { listUnits } from '@/services/units';
import { listWarehouses } from '@/services/warehouses';
import { listWorkItems } from '@/services/work-breakdown';

export const metadata: Metadata = { title: 'Gudang' };

const TYPE_LABELS = {
  IN: 'Masuk',
  OUT: 'Keluar',
  ADJUSTMENT: 'Penyesuaian',
  RETURN: 'Retur',
  TRANSFER: 'Pindah',
} as const;

type BalanceRow = {
  resource_code: string;
  resource_name: string;
  unit_code: string;
  warehouse_name: string;
  qty_on_hand: string;
  qty_received: string;
  qty_issued: string;
  moving_average_cost: string;
  stock_value: string;
  last_movement_date: string | null;
};

export default async function WarehousePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const user = await requireSessionUser();

  const project = await getProject(user.id, projectId);
  const canRecord = canRecordFieldData(project.role);
  const canManage = canEditProjectData(project.role);

  const [movements, warehouses, showCosts, balance, inStock, units, workItems] =
    await Promise.all([
      listMovements(user.id, projectId, { includeVoid: true }),
      listWarehouses(user.id, projectId),
      canViewOrgCosts(user.id),
      withUser(user.id, (tx) =>
        tx.execute<BalanceRow>(sql`
          SELECT resource_code, resource_name, unit_code, warehouse_name,
                 qty_on_hand::text, qty_received::text, qty_issued::text,
                 moving_average_cost::text, stock_value::text,
                 last_movement_date::text
          FROM v_inventory_balance
          WHERE project_id = ${projectId}
          ORDER BY warehouse_name, resource_code
        `),
      ),
      listResourcesInStock(user.id, projectId),
      listUnits(user.id),
      listWorkItems(user.id, projectId),
    ]);

  const workItemOptions = workItems.map((w) => ({ id: w.id, code: w.code, name: w.name }));

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Gudang"
        description="Saldo dan harga rata-rata dihitung ulang dari mutasi, bukan disimpan sebagai angka berjalan."
        actions={
          canRecord ? (
            <MovementActions
              projectId={projectId}
              warehouses={warehouses.map((w) => ({ id: w.id, name: w.name, isDefault: w.isDefault }))}
              resources={inStock.map((r) => ({
                id: r.id,
                code: r.code,
                name: r.name,
                unitId: r.unitId,
                unitCode: r.unitCode,
                qtyOnHand: r.qtyOnHand,
              }))}
              workItems={workItemOptions}
              units={units.map((u) => ({ id: u.id, code: u.code }))}
              canManage={canManage}
            />
          ) : null
        }
      />

      {warehouses.length === 0 ? (
        <EmptyState
          icon={Warehouse}
          title="Belum ada gudang"
          description="Buat gudang terlebih dahulu agar barang yang dibeli punya tempat masuk dan pergerakannya dapat ditelusuri."
        />
      ) : (
        <>
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Saldo stok</h2>
            {balance.length === 0 ? (
              <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                Belum ada barang di gudang. Stok bertambah ketika pembelian di-POST.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-20">Kode</TableHead>
                      <TableHead>Uraian</TableHead>
                      <TableHead>Gudang</TableHead>
                      <TableHead className="w-24 text-right">Masuk</TableHead>
                      <TableHead className="w-24 text-right">Keluar</TableHead>
                      <TableHead className="w-24 text-right">Sisa</TableHead>
                      {showCosts ? (
                        <TableHead className="w-32 text-right">Rata-rata</TableHead>
                      ) : null}
                      {showCosts ? (
                        <TableHead className="w-32 text-right">Nilai</TableHead>
                      ) : null}
                      <TableHead className="w-32">Mutasi terakhir</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {balance.map((row, i) => (
                      <TableRow key={`${row.resource_code}-${row.warehouse_name}-${i}`}>
                        <TableCell className="font-mono text-xs">{row.resource_code}</TableCell>
                        <TableCell>{row.resource_name}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {row.warehouse_name}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatQuantity(row.qty_received)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatQuantity(row.qty_issued)}
                        </TableCell>
                        <TableCell className="text-right font-mono font-medium tabular-nums">
                          {formatQuantity(row.qty_on_hand)} {row.unit_code}
                        </TableCell>
                        {showCosts ? (
                          <TableCell className="text-right font-mono tabular-nums">
                            {formatCurrency(row.moving_average_cost)}
                          </TableCell>
                        ) : null}
                        {showCosts ? (
                          <TableCell className="text-right font-mono tabular-nums">
                            {formatCurrency(row.stock_value)}
                          </TableCell>
                        ) : null}
                        <TableCell className="text-muted-foreground">
                          {row.last_movement_date === null
                            ? EMPTY_VALUE
                            : formatDay(row.last_movement_date)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Riwayat mutasi</h2>
            {movements.length === 0 ? (
              <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                Belum ada mutasi.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-28">Tanggal</TableHead>
                      <TableHead className="w-28">Jenis</TableHead>
                      <TableHead className="w-20">Kode</TableHead>
                      <TableHead>Uraian</TableHead>
                      <TableHead className="w-28 text-right">Qty</TableHead>
                      <TableHead>Pekerjaan</TableHead>
                      <TableHead>Ref</TableHead>
                      {canManage ? <TableHead className="w-28" /> : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {movements.map((m) => (
                      <TableRow key={m.id} className={m.isVoid ? 'opacity-50' : undefined}>
                        <TableCell className="whitespace-nowrap">{formatDay(m.txnDate)}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-[10px]">
                            {TYPE_LABELS[m.txnType]}
                          </Badge>
                          {m.isVoid ? (
                            <Badge variant="outline" className="ml-1 text-[10px]">
                              batal
                            </Badge>
                          ) : null}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{m.resourceCode}</TableCell>
                        <TableCell>
                          {m.resourceName}
                          {m.isVoid && m.voidReason ? (
                            <span className="block text-xs text-muted-foreground">
                              {m.voidReason}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatQuantity(m.qty)} {m.unitCode}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {m.workItemCode ?? EMPTY_VALUE}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {m.refNo ?? EMPTY_VALUE}
                        </TableCell>
                        {canManage ? (
                          <TableCell>
                            <MovementActions
                              projectId={projectId}
                              mode="row"
                              movement={{ id: m.id, isVoid: m.isVoid, label: m.resourceName }}
                              canManage={canManage}
                            />
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>

          <p className="text-xs text-muted-foreground">
            Penerimaan barang tidak dicatat di sini melainkan lewat{' '}
            <Link href={`/projects/${projectId}/purchases`} className="underline">
              POST pembelian
            </Link>
            , supaya stok dan kas selalu tercatat bersamaan.
          </p>
        </>
      )}
    </div>
  );
}
