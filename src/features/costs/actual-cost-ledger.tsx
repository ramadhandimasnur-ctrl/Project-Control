'use client';

import { Loader2, Plus, Trash2 } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { FieldShell, selectClassName } from '@/features/master-data/form-fields';
import { EMPTY_VALUE, formatCurrency, formatDay } from '@/lib/format';
import {
  ACTUAL_COST_FORM_DEFAULTS,
  COST_CATEGORY_LABELS,
  type ActualCostFormInput,
} from '@/lib/validation/costs';
import type { ActualCostRow } from '@/services/costs';

import { deleteActualCostAction, saveActualCostAction } from './actions';

/**
 * Costs that have no document of their own.
 *
 * Material issued from the warehouse is already recorded there, with quantity,
 * unit cost and the item it went to — booking it again here would be a second
 * version of the same fact. What belongs here is a day's labour, plant hire, a
 * subcontractor's invoice: money that was spent against an item and that
 * nothing else in the system knows about.
 */
export function ActualCostLedger({
  projectId,
  entries,
  workItems,
  canEdit,
}: {
  projectId: string;
  entries: ActualCostRow[];
  workItems: { id: string; code: string; name: string }[];
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<ActualCostFormInput>(ACTUAL_COST_FORM_DEFAULTS);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const set = (key: keyof ActualCostFormInput) => (value: string) =>
    setValues((current) => ({ ...current, [key]: value }));

  const submit = () => {
    startTransition(async () => {
      const result = await saveActualCostAction(projectId, null, values);
      if (result.ok) {
        toast.success('Biaya dicatat.');
        setValues(ACTUAL_COST_FORM_DEFAULTS);
        setErrors({});
        setOpen(false);
      } else {
        setErrors(result.fieldErrors ?? {});
        toast.error(result.message, { description: result.hint });
      }
    });
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Biaya yang dicatat langsung</h2>
          <p className="text-xs text-muted-foreground">
            Untuk biaya tanpa dokumen sendiri: upah harian, sewa alat, tagihan subkon. Material
            yang keluar dari gudang sudah terhitung otomatis dan tidak perlu dicatat di sini.
          </p>
        </div>
        {canEdit ? (
          <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
            <Plus className="size-4" aria-hidden />
            {open ? 'Tutup' : 'Catat biaya'}
          </Button>
        ) : null}
      </div>

      {open && canEdit ? (
        <div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-3">
          {/*
            Controlled inputs over `FieldShell` rather than the react-hook-form
            wrappers used elsewhere. This form is eight loose fields with no
            cross-field logic beyond one rule the server already enforces;
            wiring a form library to it would add a dependency to the render
            path and nothing to the user.
          */}
          <FieldShell htmlFor="costDate" label="Tanggal" error={errors.costDate}>
            <Input
              id="costDate"
              type="date"
              value={values.costDate}
              onChange={(e) => set('costDate')(e.target.value)}
            />
          </FieldShell>

          <FieldShell htmlFor="category" label="Kategori" error={errors.category}>
            <select
              id="category"
              className={selectClassName}
              value={values.category}
              onChange={(e) => set('category')(e.target.value)}
            >
              {Object.entries(COST_CATEGORY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </FieldShell>

          <FieldShell
            htmlFor="workItemId"
            label="Pekerjaan"
            hint="Kosongkan untuk biaya umum proyek."
            error={errors.workItemId}
          >
            <select
              id="workItemId"
              className={selectClassName}
              value={values.workItemId ?? ''}
              onChange={(e) => set('workItemId')(e.target.value)}
            >
              <option value="">— umum, bukan satu pekerjaan —</option>
              {workItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.code} — {item.name}
                </option>
              ))}
            </select>
          </FieldShell>

          <FieldShell
            htmlFor="qty"
            label="Kuantitas"
            hint="Opsional, bila biaya dihitung dari satuan."
            error={errors.qty}
          >
            <Input
              id="qty"
              inputMode="decimal"
              value={String(values.qty ?? '')}
              onChange={(e) => set('qty')(e.target.value)}
            />
          </FieldShell>

          <FieldShell htmlFor="unitCost" label="Harga satuan" error={errors.unitCost}>
            <Input
              id="unitCost"
              inputMode="decimal"
              value={String(values.unitCost ?? '')}
              onChange={(e) => set('unitCost')(e.target.value)}
            />
          </FieldShell>

          <FieldShell
            htmlFor="amount"
            label="Jumlah"
            hint="Isi ini, atau isi kuantitas dan harga satuan."
            error={errors.amount}
          >
            <Input
              id="amount"
              inputMode="decimal"
              value={String(values.amount ?? '')}
              onChange={(e) => set('amount')(e.target.value)}
            />
          </FieldShell>

          <FieldShell
            htmlFor="sourceRef"
            label="Rujukan"
            hint="Nomor nota, berita acara, atau kwitansi."
            error={errors.sourceRef}
          >
            <Input
              id="sourceRef"
              value={String(values.sourceRef ?? '')}
              onChange={(e) => set('sourceRef')(e.target.value)}
            />
          </FieldShell>

          <FieldShell htmlFor="note" label="Catatan" error={errors.note}>
            <Input
              id="note"
              value={String(values.note ?? '')}
              onChange={(e) => set('note')(e.target.value)}
            />
          </FieldShell>

          <div className="flex items-end">
            <Button onClick={submit} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Simpan
            </Button>
          </div>
        </div>
      ) : null}

      <div className="w-full rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">Tanggal</TableHead>
              <TableHead className="w-24">Kategori</TableHead>
              <TableHead className="min-w-48">Pekerjaan</TableHead>
              <TableHead className="min-w-32">Rujukan</TableHead>
              <TableHead className="w-32 text-right">Jumlah</TableHead>
              {canEdit ? <TableHead className="w-0" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={canEdit ? 6 : 5}
                  className="text-center text-sm text-muted-foreground"
                >
                  Belum ada biaya yang dicatat langsung.
                </TableCell>
              </TableRow>
            ) : (
              entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="font-mono text-xs">{formatDay(entry.costDate)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {COST_CATEGORY_LABELS[entry.category as keyof typeof COST_CATEGORY_LABELS] ??
                      entry.category}
                  </TableCell>
                  <TableCell>
                    {entry.workItemCode === null ? (
                      <span className="text-muted-foreground">umum proyek</span>
                    ) : (
                      <>
                        <span className="font-mono text-xs text-muted-foreground">
                          {entry.workItemCode}
                        </span>{' '}
                        {entry.workItemName}
                      </>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {entry.sourceRef ?? entry.note ?? EMPTY_VALUE}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatCurrency(entry.amount)}
                  </TableCell>
                  {canEdit ? (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Hapus biaya ${formatCurrency(entry.amount)}`}
                        disabled={pending}
                        onClick={() =>
                          startTransition(async () => {
                            const result = await deleteActualCostAction(projectId, entry.id);
                            if (result.ok) toast.success('Biaya dihapus.');
                            else toast.error(result.message, { description: result.hint });
                          })
                        }
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
