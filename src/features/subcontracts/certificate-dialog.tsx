'use client';

import { Loader2 } from 'lucide-react';
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
import { todayIso } from '@/lib/date';
import { formatCurrency, formatQuantity } from '@/lib/format';
import type { SubcontractDetail } from '@/services/subcontracts';

import { createCertificateAction } from './actions';

/**
 * Measures a period's work against the contract.
 *
 * The value is not typed. Each line is a quantity against a contract item,
 * priced at that item's rate, and the running total below shows what the
 * certificate will be worth before it is raised. Retention and the advance
 * recovery come off in the service, where the contract percentage and the
 * outstanding advance actually live.
 */
export function CertificateDialog({
  open,
  onOpenChange,
  projectId,
  subcontract,
  periods,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  subcontract: SubcontractDetail;
  periods: { id: string; label: string }[];
}) {
  const [periodId, setPeriodId] = useState(periods[0]?.id ?? '');
  /*
   * Blank by default: the project's certificate series numbers it on save.
   * Counting the certificates already on screen would repeat a number as soon
   * as one was deleted, and would collide outright with a second contract.
   */
  const [certNo, setCertNo] = useState('');
  const [certDate, setCertDate] = useState(todayIso());
  const [advanceRecouped, setAdvanceRecouped] = useState('0');
  const [qtyById, setQtyById] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const lines = subcontract.items
    .map((item) => ({ item, qty: qtyById[item.id] ?? '' }))
    .filter((row) => Number(row.qty) > 0);

  const progressValue = lines.reduce(
    (acc, row) => acc + Number(row.qty) * Number(row.item.unitRate),
    0,
  );
  const retention = progressValue * Number(subcontract.retentionPercent);
  const net = progressValue - retention - (Number(advanceRecouped) || 0);

  const submit = () => {
    startTransition(async () => {
      const result = await createCertificateAction(projectId, subcontract.id, {
        periodId,
        certNo,
        certDate,
        advanceRecouped,
        lines: lines.map((row) => ({ subcontractItemId: row.item.id, qty: row.qty })),
      });

      if (result.ok) {
        toast.success(`Sertifikat dibuat, bersih ${formatCurrency(result.netPayable)}.`);
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
          <DialogTitle>Sertifikat untuk {subcontract.partyName}</DialogTitle>
          <DialogDescription>
            Isi kuantitas yang diukur periode ini. Harga satuan dibekukan dari kontrak, jadi
            perubahan harga di kemudian hari tidak menulis ulang apa yang sudah disertifikasi.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="cert-no">Nomor</Label>
              <Input
                id="cert-no"
                placeholder="otomatis"
                value={certNo}
                onChange={(e) => setCertNo(e.target.value)}
              />
              {errors.certNo ? <p className="text-sm text-destructive">{errors.certNo}</p> : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cert-date">Tanggal</Label>
              <Input
                id="cert-date"
                type="date"
                value={certDate}
                onChange={(e) => setCertDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cert-period">Periode</Label>
              <select
                id="cert-period"
                className={selectClassName}
                value={periodId}
                onChange={(e) => setPeriodId(e.target.value)}
              >
                {periods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              {errors.periodId ? (
                <p className="text-sm text-destructive">{errors.periodId}</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cert-advance">Potongan kasbon</Label>
              <Input
                id="cert-advance"
                inputMode="decimal"
                value={advanceRecouped}
                onChange={(e) => setAdvanceRecouped(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Sisa {formatCurrency(subcontract.advanceOutstanding)}
              </p>
            </div>
          </div>

          <ul className="space-y-2">
            {subcontract.items.map((item) => {
              const remaining = Number(item.qty) - Number(item.certifiedQty);
              return (
                <li key={item.id} className="grid gap-2 rounded-md border p-3 sm:grid-cols-12">
                  <div className="sm:col-span-6">
                    <p className="text-sm font-medium">{item.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatCurrency(item.unitRate)} / {item.unitCode ?? 'sat'} · sisa{' '}
                      {formatQuantity(String(remaining))}
                    </p>
                  </div>
                  <div className="space-y-1.5 sm:col-span-3">
                    <Label htmlFor={`cert-qty-${item.id}`}>Diukur</Label>
                    <Input
                      id={`cert-qty-${item.id}`}
                      inputMode="decimal"
                      value={qtyById[item.id] ?? ''}
                      onChange={(e) => setQtyById({ ...qtyById, [item.id]: e.target.value })}
                    />
                  </div>
                  <div className="flex items-end justify-end sm:col-span-3">
                    <span className="font-mono text-sm tabular-nums">
                      {formatCurrency(
                        ((Number(qtyById[item.id]) || 0) * Number(item.unitRate)).toFixed(2),
                      )}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>

          {/*
            Shown before the certificate is raised, because the number somebody
            is about to commit to is the one they should see.
          */}
          <dl className="grid gap-3 rounded-md border p-3 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">Nilai pekerjaan</dt>
              <dd className="font-mono tabular-nums">{formatCurrency(progressValue.toFixed(2))}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Retensi</dt>
              <dd className="font-mono tabular-nums">{formatCurrency(retention.toFixed(2))}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Dibayarkan</dt>
              <dd className="font-mono font-semibold tabular-nums">
                {formatCurrency(net.toFixed(2))}
              </dd>
            </div>
          </dl>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Batal
          </Button>
          <Button onClick={submit} disabled={pending || lines.length === 0}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Buat sertifikat
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
