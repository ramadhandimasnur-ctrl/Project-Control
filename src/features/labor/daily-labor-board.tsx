'use client';

import { Loader2, Plus, Trash2 } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { selectClassName } from '@/features/master-data/form-fields';
import { todayIso } from '@/lib/date';
import { EMPTY_VALUE, formatCurrency, formatDay, formatQuantity } from '@/lib/format';
import {
  DAILY_LABOR_STATUS_LABELS,
  DAY_FRACTION_OPTIONS,
} from '@/lib/validation/labor';
import type { DailyLaborRow } from '@/services/daily-labor';

import {
  approveDailyLaborAction,
  deleteDailyLaborAction,
  markDailyLaborPaidAction,
  saveDailyLaborAction,
} from './actions';

type LineDraft = { workItemId: string; personDays: string; qtyOutput: string };

/**
 * The attendance book, and where the day went.
 *
 * Two figures are shown and never typed: person-days is headcount times the
 * fraction of a day worked, and the gross is that times the rate. They update
 * as the form is filled so that whoever is about to commit to a wage sees the
 * wage — but they are recomputed on the server, and the server's answer is the
 * one that is stored.
 */
export function DailyLaborBoard({
  projectId,
  rows,
  totals,
  foremen,
  periods,
  workItems,
  canEdit,
}: {
  projectId: string;
  rows: DailyLaborRow[];
  totals: { grossAmount: string; personDays: string };
  foremen: { id: string; code: string; name: string }[];
  periods: { id: string; label: string }[];
  workItems: { id: string; code: string; name: string }[];
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    workDate: todayIso(),
    periodId: periods[0]?.id ?? '',
    foremanId: '',
    workerCount: '1',
    dayFraction: '1',
    dailyRate: '',
  });
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const personDays = (Number(form.workerCount) || 0) * (Number(form.dayFraction) || 0);
  const gross = personDays * (Number(form.dailyRate) || 0);
  const allocated = lines.reduce((acc, line) => acc + (Number(line.personDays) || 0), 0);
  const over = allocated > personDays + 1e-9;

  const run = (work: () => Promise<{ ok: boolean; message?: string; hint?: string }>) =>
    startTransition(async () => {
      const result = await work();
      if (result.ok) toast.success('Tersimpan.');
      else toast.error(result.message ?? 'Gagal.', { description: result.hint });
    });

  const submit = () => {
    startTransition(async () => {
      const result = await saveDailyLaborAction(projectId, null, {
        ...form,
        note: '',
        lines: lines.filter((line) => Number(line.personDays) > 0),
      });

      if (result.ok) {
        toast.success(`Tercatat, ${formatCurrency(result.grossAmount)}.`);
        setLines([]);
        setForm({ ...form, dailyRate: form.dailyRate });
        setErrors({});
        setOpen(false);
      } else {
        setErrors(result.fieldErrors ?? {});
        toast.error(result.message, { description: result.hint });
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            { label: 'Total upah', value: formatCurrency(totals.grossAmount) },
            { label: 'Total hari-orang', value: formatQuantity(totals.personDays) },
          ].map((card) => (
            <div key={card.label} className="rounded-lg border px-4 py-2">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{card.label}</p>
              <p className="font-mono text-base font-semibold tabular-nums">{card.value}</p>
            </div>
          ))}
        </div>
        {canEdit ? (
          <Button size="sm" onClick={() => setOpen((v) => !v)}>
            <Plus className="size-4" aria-hidden />
            {open ? 'Tutup' : 'Catat hari kerja'}
          </Button>
        ) : null}
      </div>

      {open && canEdit ? (
        <div className="space-y-4 rounded-lg border p-4">
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <div className="space-y-1.5">
              <Label htmlFor="dl-date">Tanggal</Label>
              <Input
                id="dl-date"
                type="date"
                value={form.workDate}
                onChange={(e) => setForm({ ...form, workDate: e.target.value })}
              />
              {errors.workDate ? (
                <p className="text-sm text-destructive">{errors.workDate}</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dl-foreman">Mandor</Label>
              <select
                id="dl-foreman"
                className={selectClassName}
                value={form.foremanId}
                onChange={(e) => setForm({ ...form, foremanId: e.target.value })}
              >
                <option value="">— tidak ditautkan —</option>
                {foremen.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.code} — {f.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dl-period">Periode</Label>
              <select
                id="dl-period"
                className={selectClassName}
                value={form.periodId}
                onChange={(e) => setForm({ ...form, periodId: e.target.value })}
              >
                <option value="">— tanpa periode —</option>
                {periods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dl-count">Jumlah pekerja</Label>
              <Input
                id="dl-count"
                inputMode="numeric"
                value={form.workerCount}
                onChange={(e) => setForm({ ...form, workerCount: e.target.value })}
              />
              {errors.workerCount ? (
                <p className="text-sm text-destructive">{errors.workerCount}</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dl-fraction">Lama kerja</Label>
              {/*
                A list, not a number box. Typing 0,5625 correctly is harder
                than choosing "4,5 jam", and a mistyped fraction is a mistyped
                wage.
              */}
              <select
                id="dl-fraction"
                className={selectClassName}
                value={form.dayFraction}
                onChange={(e) => setForm({ ...form, dayFraction: e.target.value })}
              >
                {DAY_FRACTION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dl-rate">Tarif / orang / hari</Label>
              <Input
                id="dl-rate"
                inputMode="decimal"
                value={form.dailyRate}
                onChange={(e) => setForm({ ...form, dailyRate: e.target.value })}
              />
              {errors.dailyRate ? (
                <p className="text-sm text-destructive">{errors.dailyRate}</p>
              ) : null}
            </div>
          </div>

          <p className="rounded-md border bg-muted/30 p-3 text-sm">
            <span className="font-mono tabular-nums">{formatQuantity(String(personDays))}</span>{' '}
            hari-orang ·{' '}
            <span className="font-mono font-semibold tabular-nums">
              {formatCurrency(gross.toFixed(2))}
            </span>
          </p>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Dipakai untuk pekerjaan apa</h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setLines((current) => [...current, { workItemId: '', personDays: '', qtyOutput: '' }])
                }
              >
                <Plus className="size-4" aria-hidden />
                Tambah baris
              </Button>
            </div>

            {lines.map((line, index) => (
              <div key={index} className="grid gap-2 rounded-md border p-3 sm:grid-cols-12">
                <div className="space-y-1.5 sm:col-span-6">
                  <Label htmlFor={`dl-item-${index}`}>Pekerjaan</Label>
                  <select
                    id={`dl-item-${index}`}
                    className={selectClassName}
                    value={line.workItemId}
                    onChange={(e) =>
                      setLines((c) =>
                        c.map((l, i) => (i === index ? { ...l, workItemId: e.target.value } : l)),
                      )
                    }
                  >
                    <option value="">— umum, bukan satu pekerjaan —</option>
                    {workItems.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.code} — {w.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor={`dl-pd-${index}`}>Hari-orang</Label>
                  <Input
                    id={`dl-pd-${index}`}
                    inputMode="decimal"
                    value={line.personDays}
                    onChange={(e) =>
                      setLines((c) =>
                        c.map((l, i) => (i === index ? { ...l, personDays: e.target.value } : l)),
                      )
                    }
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-3">
                  <Label htmlFor={`dl-out-${index}`}>Hasil (opsional)</Label>
                  <Input
                    id={`dl-out-${index}`}
                    inputMode="decimal"
                    value={line.qtyOutput}
                    onChange={(e) =>
                      setLines((c) =>
                        c.map((l, i) => (i === index ? { ...l, qtyOutput: e.target.value } : l)),
                      )
                    }
                  />
                </div>
                <div className="flex items-end sm:col-span-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Hapus baris"
                    onClick={() => setLines((c) => c.filter((_, i) => i !== index))}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </div>
              </div>
            ))}

            {/*
              Said while it can still be corrected. The server refuses this too,
              but a form that only objects on submit makes somebody retype the
              whole day.
            */}
            {over ? (
              <p className="text-sm text-destructive">
                Pembagian {formatQuantity(String(allocated))} hari-orang melebihi{' '}
                {formatQuantity(String(personDays))} yang tercatat hari itu.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Sisa {formatQuantity(String(Math.max(personDays - allocated, 0)))} hari-orang belum
                dibagi. Sisa tetap dihitung sebagai biaya, hanya tidak menempel pada pekerjaan mana
                pun.
              </p>
            )}
          </div>

          <Button onClick={submit} disabled={pending || over}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Simpan
          </Button>
        </div>
      ) : null}

      <div className="w-full rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">Tanggal</TableHead>
              <TableHead className="min-w-36">Mandor</TableHead>
              <TableHead className="w-20 text-right">Orang</TableHead>
              <TableHead className="w-24 text-right">Hari-orang</TableHead>
              <TableHead className="w-28 text-right">Tarif</TableHead>
              <TableHead className="w-32 text-right">Upah</TableHead>
              <TableHead className="w-28 text-right">Belum dibagi</TableHead>
              <TableHead className="w-24">Status</TableHead>
              {canEdit ? <TableHead className="w-0" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={canEdit ? 9 : 8}
                  className="text-center text-sm text-muted-foreground"
                >
                  Belum ada catatan upah harian.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-xs">{formatDay(row.workDate)}</TableCell>
                  <TableCell>
                    {row.foremanName ?? <span className="text-muted-foreground">{EMPTY_VALUE}</span>}
                    {row.periodLabel ? (
                      <span className="block text-xs text-muted-foreground">{row.periodLabel}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {row.workerCount}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatQuantity(row.personDays)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatCurrency(row.dailyRate)}
                  </TableCell>
                  <TableCell className="text-right font-mono font-medium tabular-nums">
                    {formatCurrency(row.grossAmount)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {Number(row.unallocatedPersonDays) === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      formatQuantity(row.unallocatedPersonDays)
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={row.status === 'PAID' ? 'secondary' : 'outline'}>
                      {DAILY_LABOR_STATUS_LABELS[row.status]}
                    </Badge>
                  </TableCell>
                  {canEdit ? (
                    <TableCell>
                      <div className="flex w-max items-center gap-1.5 whitespace-nowrap">
                        {row.status === 'DRAFT' ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={pending}
                            onClick={() => run(() => approveDailyLaborAction(projectId, row.id))}
                          >
                            Setujui
                          </Button>
                        ) : null}
                        {row.status === 'APPROVED' ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={pending}
                            onClick={() =>
                              run(() => markDailyLaborPaidAction(projectId, row.id, todayIso()))
                            }
                          >
                            Tandai dibayar
                          </Button>
                        ) : null}
                        {row.status === 'PAID' ? null : (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Hapus catatan ${row.workDate}`}
                            disabled={pending}
                            onClick={() => run(() => deleteDailyLaborAction(projectId, row.id))}
                          >
                            <Trash2 className="size-4" aria-hidden />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))
            )}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={3}>Jumlah</TableCell>
              <TableCell className="text-right font-mono font-medium tabular-nums">
                {formatQuantity(totals.personDays)}
              </TableCell>
              <TableCell />
              <TableCell className="text-right font-mono font-medium tabular-nums">
                {formatCurrency(totals.grossAmount)}
              </TableCell>
              <TableCell colSpan={canEdit ? 3 : 2} />
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </div>
  );
}
