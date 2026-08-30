'use client';

import { Loader2, Plus, Trash2 } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

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
import { formatCurrency } from '@/lib/format';
import {
  SUBCONTRACT_STATUS_LABELS,
  SUBCONTRACT_TYPE_LABELS,
} from '@/lib/validation/subcontract';
import type { SubcontractDetail } from '@/services/subcontracts';

import { saveSubcontractAction } from './actions';

type ItemDraft = {
  workItemId: string;
  description: string;
  qty: string;
  unitId: string;
  unitRate: string;
};

const EMPTY_ITEM: ItemDraft = {
  workItemId: '',
  description: '',
  qty: '',
  unitId: '',
  unitRate: '',
};

/**
 * A piecework contract and its breakdown, in one form.
 *
 * The line total is shown but never typed: it is quantity times rate, and a
 * third box for it would be a third chance to disagree with the first two.
 * Which one a foreman argues from is whichever is larger.
 */
export function SubcontractDialog({
  open,
  onOpenChange,
  projectId,
  subcontract,
  workItems,
  units,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  subcontract: SubcontractDetail | null;
  workItems: { id: string; code: string; name: string }[];
  units: { id: string; code: string; name: string }[];
}) {
  const [values, setValues] = useState({
    partyName: subcontract?.partyName ?? '',
    scope: subcontract?.scope ?? '',
    contractType: subcontract?.contractType ?? 'UNIT_RATE',
    contractValue: subcontract?.contractValue ?? '0',
    // Stored as a fraction, typed as a percentage — nobody writes 0,1 for 10%.
    retentionPercent: subcontract === null
      ? '5'
      : String(Number(subcontract.retentionPercent) * 100),
    startDate: subcontract?.startDate ?? '',
    endDate: subcontract?.endDate ?? '',
    status: subcontract?.status ?? 'ACTIVE',
    note: subcontract?.note ?? '',
  });

  const [items, setItems] = useState<ItemDraft[]>(
    subcontract === null || subcontract.items.length === 0
      ? [EMPTY_ITEM]
      : subcontract.items.map((item) => ({
          workItemId: item.workItemId ?? '',
          description: item.description,
          qty: item.qty,
          unitId: '',
          unitRate: item.unitRate,
        })),
  );

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const setItem = (index: number, patch: Partial<ItemDraft>) =>
    setItems((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));

  const derivedTotal = items.reduce(
    (acc, item) => acc + (Number(item.qty) || 0) * (Number(item.unitRate) || 0),
    0,
  );

  const submit = () => {
    startTransition(async () => {
      const result = await saveSubcontractAction(projectId, subcontract?.id ?? null, {
        ...values,
        retentionPercent: values.retentionPercent,
        items: items.filter((item) => item.description.trim() !== ''),
      });

      if (result.ok) {
        toast.success('Kontrak tersimpan.');
        onOpenChange(false);
      } else {
        setErrors(result.fieldErrors ?? {});
        toast.error(result.message, { description: result.hint });
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {subcontract === null ? 'Kontrak borongan baru' : `Ubah ${subcontract.partyName}`}
          </DialogTitle>
          <DialogDescription>
            Nilai kontrak harga satuan dihitung dari rinciannya. Kontrak lumpsum bernilai sebesar
            yang disepakati, berapa pun jumlah rinciannya.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sc-party">Nama mandor / subkon</Label>
              <Input
                id="sc-party"
                value={values.partyName}
                onChange={(e) => setValues({ ...values, partyName: e.target.value })}
              />
              {errors.partyName ? (
                <p className="text-sm text-destructive">{errors.partyName}</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sc-scope">Lingkup</Label>
              <Input
                id="sc-scope"
                value={values.scope}
                onChange={(e) => setValues({ ...values, scope: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sc-type">Jenis kontrak</Label>
              <select
                id="sc-type"
                className={selectClassName}
                value={values.contractType}
                onChange={(e) =>
                  setValues({ ...values, contractType: e.target.value as 'LUMPSUM' | 'UNIT_RATE' })
                }
              >
                {Object.entries(SUBCONTRACT_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sc-status">Status</Label>
              <select
                id="sc-status"
                className={selectClassName}
                value={values.status}
                onChange={(e) =>
                  setValues({ ...values, status: e.target.value as typeof values.status })
                }
              >
                {Object.entries(SUBCONTRACT_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sc-value">Nilai kontrak (lumpsum)</Label>
              <Input
                id="sc-value"
                inputMode="decimal"
                disabled={values.contractType === 'UNIT_RATE'}
                value={
                  values.contractType === 'UNIT_RATE'
                    ? derivedTotal.toFixed(2)
                    : values.contractValue
                }
                onChange={(e) => setValues({ ...values, contractValue: e.target.value })}
              />
              {values.contractType === 'UNIT_RATE' ? (
                <p className="text-xs text-muted-foreground">
                  Dihitung dari rincian: {formatCurrency(derivedTotal.toFixed(2))}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sc-retention">Retensi (%)</Label>
              <Input
                id="sc-retention"
                inputMode="decimal"
                value={values.retentionPercent}
                onChange={(e) => setValues({ ...values, retentionPercent: e.target.value })}
              />
              {errors.retentionPercent ? (
                <p className="text-sm text-destructive">{errors.retentionPercent}</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sc-start">Mulai</Label>
              <Input
                id="sc-start"
                type="date"
                value={values.startDate}
                onChange={(e) => setValues({ ...values, startDate: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sc-end">Selesai</Label>
              <Input
                id="sc-end"
                type="date"
                value={values.endDate}
                onChange={(e) => setValues({ ...values, endDate: e.target.value })}
              />
              {errors.endDate ? <p className="text-sm text-destructive">{errors.endDate}</p> : null}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Rincian</h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setItems((current) => [...current, EMPTY_ITEM])}
              >
                <Plus className="size-4" aria-hidden />
                Tambah baris
              </Button>
            </div>
            {errors.items ? <p className="text-sm text-destructive">{errors.items}</p> : null}

            <ul className="space-y-2">
              {items.map((item, index) => (
                <li key={index} className="grid gap-2 rounded-md border p-3 sm:grid-cols-12">
                  <div className="space-y-1.5 sm:col-span-4">
                    <Label htmlFor={`item-desc-${index}`}>Uraian</Label>
                    <Input
                      id={`item-desc-${index}`}
                      value={item.description}
                      onChange={(e) => setItem(index, { description: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-3">
                    <Label htmlFor={`item-work-${index}`}>Pekerjaan</Label>
                    <select
                      id={`item-work-${index}`}
                      className={selectClassName}
                      value={item.workItemId}
                      onChange={(e) => setItem(index, { workItemId: e.target.value })}
                    >
                      <option value="">— tidak ditautkan —</option>
                      {workItems.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.code} — {w.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5 sm:col-span-1">
                    <Label htmlFor={`item-qty-${index}`}>Vol</Label>
                    <Input
                      id={`item-qty-${index}`}
                      inputMode="decimal"
                      value={item.qty}
                      onChange={(e) => setItem(index, { qty: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-1">
                    <Label htmlFor={`item-unit-${index}`}>Sat</Label>
                    <select
                      id={`item-unit-${index}`}
                      className={selectClassName}
                      value={item.unitId}
                      onChange={(e) => setItem(index, { unitId: e.target.value })}
                    >
                      <option value="">—</option>
                      {units.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.code}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor={`item-rate-${index}`}>Harga satuan</Label>
                    <Input
                      id={`item-rate-${index}`}
                      inputMode="decimal"
                      value={item.unitRate}
                      onChange={(e) => setItem(index, { unitRate: e.target.value })}
                    />
                  </div>
                  <div className="flex items-end sm:col-span-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Hapus baris"
                      onClick={() => setItems((current) => current.filter((_, i) => i !== index))}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Batal
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
