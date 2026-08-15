'use client';

import { Ban, Loader2, PackageMinus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
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
import { formatQuantity } from '@/lib/format';

import { recordMovementAction, voidMovementAction } from './actions';

type ResourceOption = {
  id: string;
  code: string;
  name: string;
  unitId: string;
  unitCode: string;
  qtyOnHand: string;
};

export function MovementActions({
  projectId,
  mode = 'create',
  warehouses = [],
  resources = [],
  workItems = [],
  units = [],
  movement,
  canManage,
}: {
  projectId: string;
  mode?: 'create' | 'row';
  warehouses?: { id: string; name: string; isDefault: boolean }[];
  resources?: ResourceOption[];
  workItems?: { id: string; code: string; name: string }[];
  units?: { id: string; code: string }[];
  movement?: { id: string; isVoid: boolean; label: string };
  canManage: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [pending, startTransition] = useTransition();

  if (mode === 'row') {
    if (!movement || movement.isVoid || !canManage) return null;

    return (
      <AlertDialog>
        <AlertDialogTrigger render={<Button variant="ghost" size="sm" disabled={pending} />}>
          <Ban className="size-4" aria-hidden />
          Batalkan
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Batalkan mutasi {movement.label}?</AlertDialogTitle>
            <AlertDialogDescription render={<div />}>
              <p>
                Barisnya tidak dihapus, hanya ditandai batal, sehingga riwayat tetap menunjukkan
                apa yang sempat dicatat.
              </p>
              <div className="mt-3 space-y-1.5">
                <Label htmlFor="movement-void-reason">Alasan pembatalan</Label>
                <Input
                  id="movement-void-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Contoh: salah input kuantitas"
                />
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={pending || reason.trim() === ''}
              onClick={() =>
                startTransition(async () => {
                  const result = await voidMovementAction(projectId, movement.id, reason);
                  if (result.ok) {
                    toast.success('Mutasi dibatalkan.');
                    setReason('');
                    router.refresh();
                  } else {
                    toast.error(result.message, { description: result.hint });
                  }
                })
              }
            >
              Ya, batalkan
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={warehouses.length === 0}>
        <PackageMinus className="size-4" aria-hidden />
        Catat mutasi
      </Button>
      {open ? (
        <MovementDialog
          open
          onOpenChange={setOpen}
          projectId={projectId}
          warehouses={warehouses}
          resources={resources}
          workItems={workItems}
          units={units}
        />
      ) : null}
    </>
  );
}

/**
 * Records an issue, a return or a stock-count correction.
 *
 * Goods receipts are absent on purpose: they belong to posting a purchase, so
 * that stock and cash are always committed together.
 */
function MovementDialog({
  open,
  onOpenChange,
  projectId,
  warehouses,
  resources,
  workItems,
  units,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  warehouses: { id: string; name: string; isDefault: boolean }[];
  resources: ResourceOption[];
  workItems: { id: string; code: string; name: string }[];
  units: { id: string; code: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);

  const [form, setForm] = useState({
    txnType: 'OUT' as 'OUT' | 'RETURN' | 'ADJUSTMENT',
    txnDate: new Date().toISOString().slice(0, 10),
    resourceId: '',
    warehouseId: warehouses.find((w) => w.isDefault)?.id ?? warehouses[0]?.id ?? '',
    qty: '',
    unitId: '',
    workItemId: '',
    note: '',
  });

  const selected = resources.find((r) => r.id === form.resourceId);
  const needsWorkItem = form.txnType === 'OUT';

  const submit = () => {
    startTransition(async () => {
      setError(null);
      const result = await recordMovementAction(projectId, {
        txnType: form.txnType,
        txnDate: form.txnDate,
        resourceId: form.resourceId,
        warehouseId: form.warehouseId,
        qty: form.qty,
        unitId: form.unitId === '' ? (selected?.unitId ?? '') : form.unitId,
        workItemId: form.workItemId === '' ? null : form.workItemId,
        note: form.note === '' ? null : form.note,
      });

      if (result.ok) {
        toast.success('Mutasi tercatat.');
        onOpenChange(false);
        router.refresh();
      } else {
        setError(result.hint === undefined ? { message: result.message } : result);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Catat mutasi gudang</DialogTitle>
          <DialogDescription>
            Penerimaan barang tidak dicatat di sini — itu terjadi saat pembelian di-POST, agar stok
            dan kas tercatat bersamaan.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>{error.message}</AlertTitle>
              {error.hint ? <AlertDescription>{error.hint}</AlertDescription> : null}
            </Alert>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="txnType">Jenis mutasi</Label>
              <select
                id="txnType"
                className={selectClassName}
                value={form.txnType}
                onChange={(e) =>
                  setForm({ ...form, txnType: e.target.value as typeof form.txnType })
                }
              >
                <option value="OUT">Keluar — dipakai pekerjaan</option>
                <option value="RETURN">Retur — kembali ke gudang</option>
                <option value="ADJUSTMENT">Penyesuaian — hasil stock opname</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="txnDate">Tanggal</Label>
              <Input
                id="txnDate"
                type="date"
                value={form.txnDate}
                onChange={(e) => setForm({ ...form, txnDate: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mv-resourceId">Sumber daya</Label>
            <select
              id="mv-resourceId"
              className={selectClassName}
              value={form.resourceId}
              onChange={(e) => {
                const r = resources.find((x) => x.id === e.target.value);
                setForm({ ...form, resourceId: e.target.value, unitId: r?.unitId ?? '' });
              }}
            >
              <option value="">Pilih sumber daya</option>
              {resources.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code} — {r.name} (stok {formatQuantity(r.qtyOnHand)} {r.unitCode})
                </option>
              ))}
            </select>
            {resources.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Belum ada barang bersaldo di gudang.
              </p>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="mv-warehouseId">Gudang</Label>
              <select
                id="mv-warehouseId"
                className={selectClassName}
                value={form.warehouseId}
                onChange={(e) => setForm({ ...form, warehouseId: e.target.value })}
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="mv-qty">Kuantitas</Label>
              <Input
                id="mv-qty"
                inputMode="decimal"
                value={form.qty}
                onChange={(e) => setForm({ ...form, qty: e.target.value })}
              />
              {form.txnType === 'ADJUSTMENT' ? (
                <p className="text-xs text-muted-foreground">
                  Boleh negatif, misalnya -3 bila opname menemukan barang kurang.
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="mv-unitId">Satuan</Label>
              <select
                id="mv-unitId"
                className={selectClassName}
                value={form.unitId}
                onChange={(e) => setForm({ ...form, unitId: e.target.value })}
              >
                <option value="">Ikuti katalog</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.code}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {needsWorkItem ? (
            <div className="space-y-1.5">
              <Label htmlFor="mv-workItemId">Pekerjaan yang memakai</Label>
              <select
                id="mv-workItemId"
                className={selectClassName}
                value={form.workItemId}
                onChange={(e) => setForm({ ...form, workItemId: e.target.value })}
              >
                <option value="">Pilih pekerjaan</option>
                {workItems.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code} — {w.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Wajib, agar pemakaian dapat dibandingkan dengan progres.
              </p>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="mv-note">Catatan</Label>
            <Input
              id="mv-note"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button
            disabled={pending || form.resourceId === '' || form.qty.trim() === ''}
            onClick={submit}
          >
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {pending ? 'Menyimpan…' : 'Catat'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
