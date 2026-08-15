'use client';

import { Loader2, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { selectClassName } from '@/features/master-data/form-fields';
import { toDecimal } from '@/lib/calc/decimal';
import { formatCurrency } from '@/lib/format';

import { savePurchaseAction } from './actions';
import { WarehouseCreateButton } from './warehouse-actions';

export type PurchasePickers = {
  suppliers: { id: string; code: string; name: string }[];
  warehouses: { id: string; name: string; isDefault: boolean }[];
  resources: { id: string; code: string; name: string; unitId: string; unitCode: string }[];
  units: { id: string; code: string; name: string }[];
};

type DraftLine = {
  key: number;
  resourceId: string;
  warehouseId: string;
  qty: string;
  unitId: string;
  unitPrice: string;
};

let nextKey = 1;

/**
 * Draft purchase editor.
 *
 * Line totals are shown as they are typed, but they are not the figures that
 * get saved: the server recomputes every amount from quantity and price
 * (charter rule 3). What appears here is a preview of the same arithmetic, so
 * a typo is visible before saving rather than after posting.
 */
export function PurchaseFormDialog({
  open,
  onOpenChange,
  projectId,
  pickers,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  pickers: PurchasePickers;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);

  const defaultWarehouse =
    pickers.warehouses.find((w) => w.isDefault)?.id ?? pickers.warehouses[0]?.id ?? '';

  const [header, setHeader] = useState({
    supplierId: '',
    invoiceNo: '',
    poNo: '',
    purchaseDate: new Date().toISOString().slice(0, 10),
    dueDate: '',
    vatAmount: '0',
  });

  const [lines, setLines] = useState<DraftLine[]>([
    { key: nextKey++, resourceId: '', warehouseId: defaultWarehouse, qty: '', unitId: '', unitPrice: '' },
  ]);

  const setLine = (key: number, patch: Partial<DraftLine>) => {
    setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  /*
   * Lines created before the project had a warehouse hold an empty warehouseId.
   * A <select> with no matching option still renders its first entry, so the
   * row would look complete while submit rejected it. Backfilling here keeps
   * what is on screen and what is in state the same thing.
   */
  useEffect(() => {
    if (defaultWarehouse === '') return;
    setLines((current) =>
      current.some((l) => l.warehouseId === '')
        ? current.map((l) => (l.warehouseId === '' ? { ...l, warehouseId: defaultWarehouse } : l))
        : current,
    );
  }, [defaultWarehouse]);

  /** Choosing a resource pre-fills its catalogue unit; it stays changeable. */
  const chooseResource = (key: number, resourceId: string) => {
    const resource = pickers.resources.find((r) => r.id === resourceId);
    setLine(key, { resourceId, unitId: resource?.unitId ?? '' });
  };

  const lineAmount = (line: DraftLine) => {
    if (line.qty.trim() === '' || line.unitPrice.trim() === '') return null;
    try {
      return toDecimal(line.qty).times(toDecimal(line.unitPrice));
    } catch {
      return null;
    }
  };

  const subtotal = lines.reduce(
    (acc, line) => acc.plus(lineAmount(line) ?? 0),
    toDecimal(0),
  );
  const total = subtotal.plus(toDecimal(header.vatAmount || 0));

  const submit = () => {
    const filled = lines.filter((l) => l.resourceId !== '' && l.qty.trim() !== '');

    if (filled.length === 0) {
      setError({
        message: 'Tambahkan setidaknya satu baris barang.',
        hint: 'Pilih sumber daya dan isi kuantitasnya.',
      });
      return;
    }

    const incomplete = filled.find(
      (l) => l.warehouseId === '' || l.unitId === '' || l.unitPrice.trim() === '',
    );
    if (incomplete) {
      setError({ message: 'Setiap baris harus memiliki gudang, satuan, dan harga.' });
      return;
    }

    startTransition(async () => {
      setError(null);
      const result = await savePurchaseAction(
        projectId,
        null,
        {
          supplierId: header.supplierId === '' ? null : header.supplierId,
          invoiceNo: header.invoiceNo === '' ? null : header.invoiceNo,
          poNo: header.poNo === '' ? null : header.poNo,
          purchaseDate: header.purchaseDate,
          dueDate: header.dueDate === '' ? null : header.dueDate,
          vatAmount: header.vatAmount === '' ? '0' : header.vatAmount,
        },
        filled.map((l) => ({
          resourceId: l.resourceId,
          warehouseId: l.warehouseId,
          qty: l.qty,
          unitId: l.unitId,
          unitPrice: l.unitPrice,
        })),
      );

      if (result.ok) {
        toast.success('Pembelian disimpan sebagai draf.', {
          description: 'Stok dan kas belum berubah sampai pembelian di-POST.',
        });
        onOpenChange(false);
        router.refresh();
      } else {
        setError(result.hint === undefined ? { message: result.message } : result);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Pembelian baru</DialogTitle>
          <DialogDescription>
            Disimpan sebagai draf. Stok dan kas baru berubah ketika pembelian di-POST.
          </DialogDescription>
        </DialogHeader>

        {pickers.warehouses.length === 0 ? (
          <Alert variant="destructive">
            <AlertTitle>Proyek ini belum memiliki gudang</AlertTitle>
            <AlertDescription className="space-y-3">
              <p>Buat gudang terlebih dahulu agar barang yang dibeli punya tempat masuk.</p>
              {/*
                Reaching this dialog already required ENGINEER access, the same
                authority saveWarehouse demands, and the action re-checks it
                server-side regardless.
              */}
              <WarehouseCreateButton
                projectId={projectId}
                canManage
                isFirst
                size="sm"
                label="Buat gudang sekarang"
              />
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-4">
            {error ? (
              <Alert variant="destructive">
                <AlertTitle>{error.message}</AlertTitle>
                {error.hint ? <AlertDescription>{error.hint}</AlertDescription> : null}
              </Alert>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Pemasok" htmlFor="supplierId">
                <select
                  id="supplierId"
                  className={selectClassName}
                  value={header.supplierId}
                  onChange={(e) => setHeader({ ...header, supplierId: e.target.value })}
                >
                  <option value="">Tanpa pemasok</option>
                  {pickers.suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code} — {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="No. Faktur" htmlFor="invoiceNo">
                <Input
                  id="invoiceNo"
                  value={header.invoiceNo}
                  onChange={(e) => setHeader({ ...header, invoiceNo: e.target.value })}
                />
              </Field>
              <Field label="No. PO" htmlFor="poNo">
                <Input
                  id="poNo"
                  value={header.poNo}
                  onChange={(e) => setHeader({ ...header, poNo: e.target.value })}
                />
              </Field>
              <Field label="Tanggal pembelian" htmlFor="purchaseDate">
                <Input
                  id="purchaseDate"
                  type="date"
                  value={header.purchaseDate}
                  onChange={(e) => setHeader({ ...header, purchaseDate: e.target.value })}
                />
              </Field>
              <Field
                label="Jatuh tempo"
                htmlFor="dueDate"
                hint="Menentukan tanggal kas keluar bila belum dibayar."
              >
                <Input
                  id="dueDate"
                  type="date"
                  value={header.dueDate}
                  onChange={(e) => setHeader({ ...header, dueDate: e.target.value })}
                />
              </Field>
              <Field label="PPN (Rp)" htmlFor="vatAmount">
                <Input
                  id="vatAmount"
                  inputMode="decimal"
                  value={header.vatAmount}
                  onChange={(e) => setHeader({ ...header, vatAmount: e.target.value })}
                />
              </Field>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Barang</p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setLines((c) => [
                      ...c,
                      {
                        key: nextKey++,
                        resourceId: '',
                        warehouseId: defaultWarehouse,
                        qty: '',
                        unitId: '',
                        unitPrice: '',
                      },
                    ])
                  }
                >
                  <Plus className="size-4" aria-hidden />
                  Tambah baris
                </Button>
              </div>

              <div className="space-y-2">
                {lines.map((line) => (
                  <div
                    key={line.key}
                    className="grid items-end gap-2 rounded-md border p-2 sm:grid-cols-[1fr_8rem_6rem_5rem_8rem_2rem]"
                  >
                    <select
                      aria-label="Sumber daya"
                      className={selectClassName}
                      value={line.resourceId}
                      onChange={(e) => chooseResource(line.key, e.target.value)}
                    >
                      <option value="">Pilih sumber daya</option>
                      {pickers.resources.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.code} — {r.name}
                        </option>
                      ))}
                    </select>

                    <select
                      aria-label="Gudang"
                      className={selectClassName}
                      value={line.warehouseId}
                      onChange={(e) => setLine(line.key, { warehouseId: e.target.value })}
                    >
                      {pickers.warehouses.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>

                    <Input
                      aria-label="Kuantitas"
                      inputMode="decimal"
                      placeholder="Qty"
                      value={line.qty}
                      onChange={(e) => setLine(line.key, { qty: e.target.value })}
                    />

                    <select
                      aria-label="Satuan"
                      className={selectClassName}
                      value={line.unitId}
                      onChange={(e) => setLine(line.key, { unitId: e.target.value })}
                    >
                      <option value="">Sat</option>
                      {pickers.units.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.code}
                        </option>
                      ))}
                    </select>

                    <Input
                      aria-label="Harga satuan"
                      inputMode="decimal"
                      placeholder="Harga"
                      value={line.unitPrice}
                      onChange={(e) => setLine(line.key, { unitPrice: e.target.value })}
                    />

                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Hapus baris"
                      disabled={lines.length === 1}
                      onClick={() => setLines((c) => c.filter((l) => l.key !== line.key))}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border bg-muted/30 p-3 text-right text-sm">
              <p className="text-muted-foreground">
                Subtotal <span className="font-mono">{formatCurrency(subtotal)}</span> + PPN{' '}
                <span className="font-mono">{formatCurrency(header.vatAmount || 0)}</span>
              </p>
              <p className="mt-1 font-mono text-lg font-semibold tabular-nums">
                {formatCurrency(total)}
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button
            disabled={pending || pickers.warehouses.length === 0}
            onClick={submit}
          >
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {pending ? 'Menyimpan…' : 'Simpan draf'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
