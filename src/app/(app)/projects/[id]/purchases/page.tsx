import { Receipt } from 'lucide-react';
import type { Metadata } from 'next';

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
import { PurchaseActions } from '@/features/purchases/purchase-actions';
import { canEditProjectData, canEditContractTerms } from '@/lib/auth/roles';
import { EMPTY_VALUE, formatCurrency, formatDay } from '@/lib/format';
import { canViewOrgCosts } from '@/services/org-access';
import { getProject } from '@/services/projects';
import { listPurchases } from '@/services/purchases';
import { listResources } from '@/services/resources';
import { requireSessionUser } from '@/services/session';
import { listSuppliers } from '@/services/suppliers';
import { listUnits } from '@/services/units';
import { listWarehouses } from '@/services/warehouses';

export const metadata: Metadata = { title: 'Pembelian' };

const STATUS_LABELS = { DRAFT: 'Draf', POSTED: 'Diposting', VOID: 'Dibatalkan' } as const;
const STATUS_VARIANTS = {
  DRAFT: 'outline',
  POSTED: 'default',
  VOID: 'secondary',
} as const;

export default async function PurchasesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const user = await requireSessionUser();

  const project = await getProject(user.id, projectId);
  const [purchases, showCosts, warehouses, suppliers, units, resources] = await Promise.all([
    listPurchases(user.id, projectId),
    canViewOrgCosts(user.id),
    listWarehouses(user.id, projectId),
    listSuppliers(user.id),
    listUnits(user.id),
    listResources(user.id, { limit: 500 }),
  ]);

  const canEdit = canEditProjectData(project.role);
  // Posting commits money, so it sits with the same authority as contract terms.
  const canPost = canEditContractTerms(project.role);

  const pickers = {
    suppliers: suppliers.map((s) => ({ id: s.id, code: s.code, name: s.name })),
    warehouses: warehouses.map((w) => ({ id: w.id, name: w.name, isDefault: w.isDefault })),
    units: units.map((u) => ({ id: u.id, code: u.code, name: u.name })),
    resources: resources.items.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      unitId: units.find((u) => u.code === r.unitCode)?.id ?? '',
      unitCode: r.unitCode,
    })),
  };

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Pembelian"
        description="POST menulis mutasi stok dan kas keluar dalam satu transaksi."
        actions={
          canEdit ? (
            <PurchaseActions
              projectId={projectId}
              mode="create"
              canPost={canPost}
              pickers={pickers}
            />
          ) : null
        }
      />

      {purchases.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="Belum ada pembelian"
          description="Catat pembelian material di sini. Selama masih berstatus draf, isinya bebas diubah; setelah di-POST, stok dan kas ikut tercatat."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-32">Tanggal</TableHead>
                <TableHead className="w-32">No. Faktur</TableHead>
                <TableHead>Pemasok</TableHead>
                <TableHead className="w-20 text-right">Baris</TableHead>
                {showCosts ? <TableHead className="w-36 text-right">Total</TableHead> : null}
                <TableHead className="w-28">Status</TableHead>
                <TableHead className="w-44" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {purchases.map((purchase) => (
                <TableRow key={purchase.id}>
                  <TableCell className="whitespace-nowrap">
                    {formatDay(purchase.purchaseDate)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {purchase.invoiceNo ?? purchase.poNo ?? EMPTY_VALUE}
                  </TableCell>
                  <TableCell>{purchase.supplierName ?? EMPTY_VALUE}</TableCell>
                  <TableCell className="text-right tabular-nums">{purchase.lineCount}</TableCell>
                  {showCosts ? (
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatCurrency(purchase.totalAmount)}
                    </TableCell>
                  ) : null}
                  <TableCell>
                    <Badge variant={STATUS_VARIANTS[purchase.status]} className="text-[10px]">
                      {STATUS_LABELS[purchase.status]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <PurchaseActions
                      projectId={projectId}
                      mode="row"
                      canPost={canPost}
                      purchase={{
                        id: purchase.id,
                        status: purchase.status,
                        label: purchase.invoiceNo ?? purchase.poNo ?? formatDay(purchase.purchaseDate),
                      }}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Pembelian berstatus draf belum mempengaruhi stok maupun kas. Setelah di-POST, koreksi hanya
        dapat dilakukan dengan membatalkannya, dan mutasi lamanya tetap terlihat sebagai riwayat.
      </p>

      <p className="text-xs text-muted-foreground">
        Pengakuan biaya proyek ini:{' '}
        <strong>
          {project.costRecognition === 'PURCHASE_BASED' ? 'saat pembelian' : 'saat pemakaian'}
        </strong>
        .{' '}
        {project.costRecognition === 'PURCHASE_BASED'
          ? 'POST akan mencatat kas keluar.'
          : 'POST hanya menambah stok; kas dicatat saat material dipakai.'}
      </p>
    </div>
  );
}
