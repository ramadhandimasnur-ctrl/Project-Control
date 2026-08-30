'use client';

import { HandCoins, Loader2, Plus, Trash2 } from 'lucide-react';
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
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EMPTY_VALUE, formatCurrency, formatDay, formatPercent, formatQuantity } from '@/lib/format';
import { todayIso } from '@/lib/date';
import {
  CERTIFICATE_STATUS_LABELS,
  SUBCONTRACT_STATUS_LABELS,
  SUBCONTRACT_TYPE_LABELS,
} from '@/lib/validation/subcontract';
import type { SubcontractDetail, SubcontractRow } from '@/services/subcontracts';

import {
  approveCertificateAction,
  deleteAdvanceAction,
  deleteCertificateAction,
  markCertificatePaidAction,
  recordAdvanceAction,
} from './actions';
import { CertificateDialog } from './certificate-dialog';
import { SubcontractDialog } from './subcontract-dialog';

/**
 * Piecework contracts, and what has been certified against them.
 *
 * The list carries the four figures a site manager checks weekly: what was
 * agreed, what has been certified, what was advanced and not yet recovered,
 * and what is still held as retention. The detail adds the comparison the
 * whole record exists for — certified value against the labour the RAP
 * budgeted for the same work.
 */
export function SubcontractBoard({
  projectId,
  rows,
  selected,
  workItems,
  units,
  periods,
  canManage,
}: {
  projectId: string;
  rows: SubcontractRow[];
  selected: SubcontractDetail | null;
  workItems: { id: string; code: string; name: string }[];
  units: { id: string; code: string; name: string }[];
  periods: { id: string; label: string }[];
  canManage: boolean;
}) {
  const [editing, setEditing] = useState<SubcontractDetail | null | undefined>(undefined);
  const [certifying, setCertifying] = useState(false);
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [advance, setAdvance] = useState({ advanceDate: todayIso(), amount: '', note: '' });
  const [pending, startTransition] = useTransition();

  const run = (work: () => Promise<{ ok: boolean; message?: string; hint?: string }>) =>
    startTransition(async () => {
      const result = await work();
      if (result.ok) toast.success('Tersimpan.');
      else toast.error(result.message ?? 'Gagal.', { description: result.hint });
    });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Kontrak borongan</h2>
        {canManage ? (
          <Button size="sm" onClick={() => setEditing(null)}>
            <Plus className="size-4" aria-hidden />
            Kontrak baru
          </Button>
        ) : null}
      </div>

      <div className="w-full rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-40">Mandor / subkon</TableHead>
              <TableHead className="w-28">Jenis</TableHead>
              <TableHead className="w-32 text-right">Nilai kontrak</TableHead>
              <TableHead className="w-32 text-right">Disertifikasi</TableHead>
              <TableHead className="w-20 text-right">Capaian</TableHead>
              <TableHead className="w-32 text-right">Kasbon belum kembali</TableHead>
              <TableHead className="w-28 text-right">Retensi</TableHead>
              <TableHead className="w-24">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                  Belum ada kontrak borongan pada proyek ini.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={selected?.id === row.id ? 'bg-accent text-accent-foreground' : ''}
                >
                  <TableCell>
                    <a className="underline-offset-4 hover:underline" href={`?sub=${row.id}`}>
                      {row.partyName}
                    </a>
                    {row.scope ? (
                      <span className="block text-xs text-muted-foreground">{row.scope}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {SUBCONTRACT_TYPE_LABELS[row.contractType]}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatCurrency(row.contractValue)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatCurrency(row.certifiedValue)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {row.completion === null ? EMPTY_VALUE : formatPercent(row.completion, 0)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatCurrency(row.advanceOutstanding)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatCurrency(row.retentionHeld)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={row.status === 'ACTIVE' ? 'secondary' : 'outline'}>
                      {SUBCONTRACT_STATUS_LABELS[row.status]}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {selected === null ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Pilih satu kontrak untuk melihat rincian, sertifikat, dan kasbonnya.
        </p>
      ) : (
        <div className="space-y-6 rounded-lg border p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="font-semibold">{selected.partyName}</h3>
              <p className="text-xs text-muted-foreground">
                {SUBCONTRACT_TYPE_LABELS[selected.contractType]} · retensi{' '}
                {formatPercent(selected.retentionPercent, 0)}
                {selected.startDate === null
                  ? null
                  : ` · ${formatDay(selected.startDate)}${
                      selected.endDate === null ? '' : ` – ${formatDay(selected.endDate)}`
                    }`}
              </p>
            </div>
            {canManage ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditing(selected)}>
                  Ubah kontrak
                </Button>
                <Button variant="outline" size="sm" onClick={() => setAdvanceOpen((v) => !v)}>
                  <HandCoins className="size-4" aria-hidden />
                  Kasbon
                </Button>
                <Button size="sm" onClick={() => setCertifying(true)}>
                  <Plus className="size-4" aria-hidden />
                  Sertifikat
                </Button>
              </div>
            ) : null}
          </div>

          {/*
            The comparison the whole record exists for. Null when the contract
            names no work items — a lump sum for "site clearance" cannot be
            measured against a budget line that does not exist, and inventing
            one would be worse than admitting it.
          */}
          {selected.vsRapLabour === null ? (
            <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              Rincian kontrak ini belum ditautkan ke pekerjaan, jadi nilainya belum dapat
              dibandingkan dengan anggaran upah RAP.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-3">
              {[
                { label: 'Disertifikasi', value: selected.vsRapLabour.certified },
                { label: 'Anggaran upah RAP', value: selected.vsRapLabour.budgeted },
                { label: 'Selisih', value: selected.vsRapLabour.variance },
              ].map((card) => (
                <div key={card.label} className="rounded-md border p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    {card.label}
                  </p>
                  <p
                    className={`mt-1 font-mono text-base font-semibold tabular-nums ${
                      card.label === 'Selisih' && Number(card.value) < 0 ? 'text-destructive' : ''
                    }`}
                  >
                    {formatCurrency(card.value)}
                  </p>
                </div>
              ))}
            </div>
          )}

          {advanceOpen && canManage ? (
            <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="adv-date">Tanggal</Label>
                <Input
                  id="adv-date"
                  type="date"
                  value={advance.advanceDate}
                  onChange={(e) => setAdvance({ ...advance, advanceDate: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="adv-amount">Nilai</Label>
                <Input
                  id="adv-amount"
                  inputMode="decimal"
                  value={advance.amount}
                  onChange={(e) => setAdvance({ ...advance, amount: e.target.value })}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="adv-note">Catatan</Label>
                <div className="flex gap-2">
                  <Input
                    id="adv-note"
                    value={advance.note}
                    onChange={(e) => setAdvance({ ...advance, note: e.target.value })}
                  />
                  <Button
                    disabled={pending}
                    onClick={() =>
                      run(async () => {
                        const result = await recordAdvanceAction(projectId, selected.id, advance);
                        if (result.ok) setAdvance({ advanceDate: todayIso(), amount: '', note: '' });
                        return result;
                      })
                    }
                  >
                    {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                    Catat
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          <section className="space-y-2">
            <h4 className="text-sm font-medium">Rincian kontrak</h4>
            <div className="w-full rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-48">Uraian</TableHead>
                    <TableHead className="w-24">Pekerjaan</TableHead>
                    <TableHead className="w-24 text-right">Volume</TableHead>
                    <TableHead className="w-28 text-right">Harga satuan</TableHead>
                    <TableHead className="w-28 text-right">Nilai</TableHead>
                    <TableHead className="w-28 text-right">Sudah diukur</TableHead>
                    <TableHead className="w-32 text-right">Upah RAP</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selected.items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                        Kontrak ini belum punya rincian.
                      </TableCell>
                    </TableRow>
                  ) : (
                    selected.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>{item.description}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {item.workItemCode ?? EMPTY_VALUE}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatQuantity(item.qty)}
                          <span className="ml-1 text-xs text-muted-foreground">
                            {item.unitCode ?? ''}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatCurrency(item.unitRate)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatCurrency(item.amount)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatQuantity(item.certifiedQty)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                          {item.rapLabourValue === null
                            ? EMPTY_VALUE
                            : formatCurrency(item.rapLabourValue)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </section>

          <section className="space-y-2">
            <h4 className="text-sm font-medium">Sertifikat</h4>
            <div className="w-full rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">Nomor</TableHead>
                    <TableHead className="w-28">Tanggal</TableHead>
                    <TableHead className="w-28">Periode</TableHead>
                    <TableHead className="w-28 text-right">Nilai</TableHead>
                    <TableHead className="w-28 text-right">Retensi</TableHead>
                    <TableHead className="w-28 text-right">Kasbon</TableHead>
                    <TableHead className="w-28 text-right">Bersih</TableHead>
                    <TableHead className="w-24">Status</TableHead>
                    {canManage ? <TableHead className="w-0" /> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selected.certificates.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={canManage ? 9 : 8}
                        className="text-center text-sm text-muted-foreground"
                      >
                        Belum ada sertifikat.
                      </TableCell>
                    </TableRow>
                  ) : (
                    selected.certificates.map((cert) => (
                      <TableRow key={cert.id}>
                        <TableCell className="font-mono text-xs">{cert.certNo}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDay(cert.certDate)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {cert.periodLabel ?? EMPTY_VALUE}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatCurrency(cert.progressValue)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatCurrency(cert.retentionWithheld)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatCurrency(cert.advanceRecouped)}
                        </TableCell>
                        <TableCell className="text-right font-mono font-medium tabular-nums">
                          {formatCurrency(cert.netPayable)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={cert.status === 'PAID' ? 'secondary' : 'outline'}>
                            {CERTIFICATE_STATUS_LABELS[cert.status]}
                          </Badge>
                        </TableCell>
                        {canManage ? (
                          <TableCell>
                            <div className="flex w-max items-center gap-1.5 whitespace-nowrap">
                              {cert.status === 'DRAFT' ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={pending}
                                  onClick={() =>
                                    run(() => approveCertificateAction(projectId, cert.id))
                                  }
                                >
                                  Setujui
                                </Button>
                              ) : null}
                              {cert.status === 'APPROVED' ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={pending}
                                  onClick={() =>
                                    run(() =>
                                      markCertificatePaidAction(projectId, cert.id, todayIso()),
                                    )
                                  }
                                >
                                  Tandai dibayar
                                </Button>
                              ) : null}
                              {cert.status === 'PAID' ? null : (
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label={`Hapus sertifikat ${cert.certNo}`}
                                  disabled={pending}
                                  onClick={() =>
                                    run(() => deleteCertificateAction(projectId, cert.id))
                                  }
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
              </Table>
            </div>
          </section>

          <section className="space-y-2">
            <h4 className="text-sm font-medium">Kasbon</h4>
            {selected.advances.length === 0 ? (
              <p className="text-sm text-muted-foreground">Belum ada kasbon.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {selected.advances.map((row) => (
                  <li
                    key={row.id}
                    className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
                  >
                    <span className="text-muted-foreground">{formatDay(row.advanceDate)}</span>
                    <span className="flex-1">{row.note ?? EMPTY_VALUE}</span>
                    <span className="font-mono tabular-nums">{formatCurrency(row.amount)}</span>
                    {canManage ? (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Hapus kasbon"
                        disabled={pending}
                        onClick={() => run(() => deleteAdvanceAction(projectId, row.id))}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {editing !== undefined ? (
        <SubcontractDialog
          open
          onOpenChange={(open) => !open && setEditing(undefined)}
          projectId={projectId}
          subcontract={editing}
          workItems={workItems}
          units={units}
        />
      ) : null}

      {certifying && selected !== null ? (
        <CertificateDialog
          open
          onOpenChange={setCertifying}
          projectId={projectId}
          subcontract={selected}
          periods={periods}
        />
      ) : null}
    </div>
  );
}
