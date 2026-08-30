'use client';

import { Loader2, Plus } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { todayIso } from '@/lib/date';
import { EMPTY_VALUE, formatCurrency, formatQuantity } from '@/lib/format';
import type { CentralStockRow, CentralWarehouseRow } from '@/services/central-warehouse';

import { allocateAction, recordReceiptAction, saveCentralWarehouseAction } from './central-warehouse-actions';
import { selectClassName } from './form-fields';

/**
 * Stores that belong to the organisation, and what is in them.
 *
 * Two things happen here and nothing else: stock arrives, and stock is handed
 * to a project. Everything a project then does with it — issuing to a work
 * item, costing, planning — already happens on the project's own screens, and
 * putting a second copy of that here would be two places to look and two
 * answers to compare.
 */
export function CentralWarehouseManager({
  warehouses,
  selected,
  stock,
  resources,
  projects,
  canManage,
}: {
  warehouses: CentralWarehouseRow[];
  selected: string | null;
  stock: CentralStockRow[];
  resources: { id: string; code: string; name: string }[];
  projects: { id: string; code: string; name: string }[];
  canManage: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: '', city: '', address: '' });
  const [receipt, setReceipt] = useState({
    resourceId: resources[0]?.id ?? '',
    receiptDate: todayIso(),
    qty: '',
    unitPrice: '',
    vatPercent: '0',
    docNo: '',
    dueDate: '',
  });
  const [allocation, setAllocation] = useState({
    projectId: projects[0]?.id ?? '',
    resourceId: resources[0]?.id ?? '',
    allocatedOn: todayIso(),
    qty: '',
  });
  const [pending, startTransition] = useTransition();

  const run = (work: () => Promise<{ ok: boolean; message?: string; hint?: string }>) =>
    startTransition(async () => {
      const result = await work();
      if (result.ok) toast.success(result.message ?? 'Tersimpan.');
      else toast.error(result.message ?? 'Gagal.', { description: result.hint });
    });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {warehouses.length} gudang pusat. Gudang proyek dikelola di halaman Gudang masing-masing
          proyek.
        </p>
        {canManage ? (
          <Button size="sm" variant="outline" onClick={() => setCreating((v) => !v)}>
            <Plus className="size-4" aria-hidden />
            {creating ? 'Tutup' : 'Gudang baru'}
          </Button>
        ) : null}
      </div>

      {creating && canManage ? (
        <div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="wh-name">Nama</Label>
            <Input
              id="wh-name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wh-city">Kota</Label>
            <Input
              id="wh-city"
              value={draft.city}
              onChange={(e) => setDraft({ ...draft, city: e.target.value })}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="wh-address">Alamat</Label>
            <div className="flex gap-2">
              <Input
                id="wh-address"
                value={draft.address}
                onChange={(e) => setDraft({ ...draft, address: e.target.value })}
              />
              <Button
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    const result = await saveCentralWarehouseAction(null, draft);
                    if (result.ok) {
                      setDraft({ name: '', city: '', address: '' });
                      setCreating(false);
                    }
                    return result;
                  })
                }
              >
                {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                Simpan
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="w-full rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-48">Gudang</TableHead>
              <TableHead className="w-32">Kota</TableHead>
              <TableHead className="w-24 text-right">Jenis barang</TableHead>
              <TableHead className="w-36 text-right">Nilai stok</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {warehouses.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                  Belum ada gudang pusat.
                </TableCell>
              </TableRow>
            ) : (
              warehouses.map((row) => (
                <TableRow
                  key={row.id}
                  className={selected === row.id ? 'bg-accent text-accent-foreground' : ''}
                >
                  <TableCell>
                    <a className="underline-offset-4 hover:underline" href={`?wh=${row.id}`}>
                      {row.name}
                    </a>
                    {row.address ? (
                      <span className="block text-xs text-muted-foreground">{row.address}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{row.city ?? EMPTY_VALUE}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {row.resourceCount}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatCurrency(row.stockValue)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {selected === null ? null : (
        <div className="space-y-4 rounded-lg border p-4">
          <h2 className="text-sm font-semibold">Stok</h2>

          <div className="w-full rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Kode</TableHead>
                  <TableHead className="min-w-40">Sumber daya</TableHead>
                  <TableHead className="w-28 text-right">Diterima</TableHead>
                  <TableHead className="w-28 text-right">Dialokasikan</TableHead>
                  <TableHead className="w-28 text-right">Sisa</TableHead>
                  <TableHead className="w-28 text-right">Harga rata</TableHead>
                  <TableHead className="w-32 text-right">Nilai</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stock.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                      Gudang ini belum menerima barang.
                    </TableCell>
                  </TableRow>
                ) : (
                  stock.map((row) => (
                    <TableRow key={row.resourceId}>
                      <TableCell className="font-mono text-xs">{row.code}</TableCell>
                      <TableCell>{row.name}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatQuantity(row.received)}
                        <span className="ml-1 text-xs text-muted-foreground">{row.unitCode}</span>
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatQuantity(row.allocated)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatQuantity(row.onHand)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatCurrency(row.avgUnitCost)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatCurrency(row.value)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {canManage ? (
            <>
              <section className="space-y-2">
                <h3 className="text-sm font-medium">Terima barang</h3>
                <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-7">
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="rc-res">Sumber daya</Label>
                    <select
                      id="rc-res"
                      className={selectClassName}
                      value={receipt.resourceId}
                      onChange={(e) => setReceipt({ ...receipt, resourceId: e.target.value })}
                    >
                      {resources.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.code} — {r.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rc-date">Tanggal</Label>
                    <Input
                      id="rc-date"
                      type="date"
                      value={receipt.receiptDate}
                      onChange={(e) => setReceipt({ ...receipt, receiptDate: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rc-qty">Jumlah</Label>
                    <Input
                      id="rc-qty"
                      inputMode="decimal"
                      value={receipt.qty}
                      onChange={(e) => setReceipt({ ...receipt, qty: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rc-price">Harga satuan</Label>
                    <Input
                      id="rc-price"
                      inputMode="decimal"
                      value={receipt.unitPrice}
                      onChange={(e) => setReceipt({ ...receipt, unitPrice: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rc-vat">PPN (%)</Label>
                    <Input
                      id="rc-vat"
                      inputMode="decimal"
                      value={receipt.vatPercent}
                      onChange={(e) => setReceipt({ ...receipt, vatPercent: e.target.value })}
                    />
                  </div>
                  <div className="flex items-end">
                    <Button
                      disabled={pending}
                      onClick={() =>
                        run(async () => {
                          const result = await recordReceiptAction(selected, receipt);
                          if (result.ok) setReceipt({ ...receipt, qty: '', unitPrice: '' });
                          return result;
                        })
                      }
                    >
                      Terima
                    </Button>
                  </div>
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-medium">Kirim ke proyek</h3>
                <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-5">
                  <div className="space-y-1.5">
                    <Label htmlFor="al-project">Proyek</Label>
                    <select
                      id="al-project"
                      className={selectClassName}
                      value={allocation.projectId}
                      onChange={(e) => setAllocation({ ...allocation, projectId: e.target.value })}
                    >
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.code} — {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="al-res">Sumber daya</Label>
                    <select
                      id="al-res"
                      className={selectClassName}
                      value={allocation.resourceId}
                      onChange={(e) => setAllocation({ ...allocation, resourceId: e.target.value })}
                    >
                      {resources.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.code} — {r.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="al-date">Tanggal</Label>
                    <Input
                      id="al-date"
                      type="date"
                      value={allocation.allocatedOn}
                      onChange={(e) => setAllocation({ ...allocation, allocatedOn: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="al-qty">Jumlah</Label>
                    <Input
                      id="al-qty"
                      inputMode="decimal"
                      value={allocation.qty}
                      onChange={(e) => setAllocation({ ...allocation, qty: e.target.value })}
                    />
                  </div>
                  <div className="flex items-end">
                    <Button
                      disabled={pending}
                      onClick={() =>
                        run(async () => {
                          const result = await allocateAction(selected, allocation);
                          if (result.ok) setAllocation({ ...allocation, qty: '' });
                          return result;
                        })
                      }
                    >
                      Kirim
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Material yang dikirim masuk sebagai mutasi masuk di gudang utama proyek tujuan,
                  pada harga rata-rata tertimbang gudang pusat. Sejak itu ia berperilaku persis
                  seperti material yang dibeli proyek itu sendiri.
                </p>
              </section>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
