'use client';

import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EMPTY_VALUE, formatCoefficient, formatCurrency, formatPercent, formatQuantity } from '@/lib/format';
import { AHSP_ROLE_LABELS, AHSP_ROLE_ORDER } from '@/lib/validation/work-breakdown';
import type { AhspLineView, AhspRole, WorkItemEstimateView } from '@/services/ahsp';

import { deleteAhspLineAction } from './actions';
import { AhspLineDialog } from './ahsp-line-dialog';

/**
 * The right-hand panel: one work item's analysis, grouped into the sections
 * the source workbook uses (A TENAGA / B BAHAN / C ALAT / D SUBKON / E PAKET).
 *
 * Every figure is rendered from what the server computed. Nothing is
 * multiplied here — charter rule 3 puts the arithmetic in lib/calc, and a
 * total recomputed in the browser is a total that can disagree with the one
 * the estimate page shows.
 */
export function AhspPanel({
  projectId,
  workItemId,
  workItemCode,
  workItemName,
  unitCode,
  estimate,
  resources,
  canEdit,
  showCosts,
}: {
  projectId: string;
  workItemId: string;
  workItemCode: string;
  workItemName: string;
  unitCode: string;
  estimate: WorkItemEstimateView;
  resources: { id: string; code: string; name: string; spec: string | null; unitCode: string }[];
  canEdit: boolean;
  showCosts: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<AhspLineView | null>(null);
  const [adding, setAdding] = useState<AhspRole | null>(null);
  const [pending, startTransition] = useTransition();

  const byRole = new Map<AhspRole, AhspLineView[]>();
  for (const role of AHSP_ROLE_ORDER) byRole.set(role, []);
  for (const line of estimate.lines) byRole.get(line.role)?.push(line);

  const removeLine = (line: AhspLineView) => {
    startTransition(async () => {
      const result = await deleteAhspLineAction(projectId, workItemId, line.id);
      if (result.ok) {
        toast.success('Baris analisa dihapus.');
        router.refresh();
      } else {
        toast.error(result.message, { description: result.hint });
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-3">
        <div>
          <p className="font-mono text-xs text-muted-foreground">{workItemCode}</p>
          <h2 className="text-lg font-semibold">{workItemName}</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Volume {formatQuantity(estimate.volume)} {unitCode}
        </p>
      </div>

      {estimate.missingPrices.length > 0 ? (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" aria-hidden />
          <AlertTitle>
            {estimate.missingPrices.length} harga belum diisi, sehingga total di bawah belum lengkap
          </AlertTitle>
          <AlertDescription>
            <ul className="mt-1 list-inside list-disc">
              {estimate.missingPrices.slice(0, 8).map((m) => (
                <li key={`${m.resourceId}-${m.priceType}`}>
                  Harga {m.priceType} untuk &ldquo;{m.name}&rdquo; ({m.code})
                </li>
              ))}
            </ul>
            <p className="mt-2">Tambahkan di Master Data → Sumber Daya → Tambah harga.</p>
          </AlertDescription>
        </Alert>
      ) : null}

      {AHSP_ROLE_ORDER.map((role) => {
        const lines = byRole.get(role) ?? [];
        if (lines.length === 0 && !canEdit) return null;

        return (
          <section key={role} className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">{AHSP_ROLE_LABELS[role]}</h3>
              {canEdit ? (
                <Button variant="ghost" size="sm" onClick={() => setAdding(role)}>
                  <Plus className="size-4" aria-hidden />
                  Tambah baris
                </Button>
              ) : null}
            </div>

            {lines.length === 0 ? (
              <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
                Belum ada baris pada bagian ini.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-20">Kode</TableHead>
                      <TableHead>Uraian</TableHead>
                      <TableHead className="w-16">Sat</TableHead>
                      <TableHead className="w-24 text-right">Koef</TableHead>
                      <TableHead className="w-20 text-right">Susut</TableHead>
                      <TableHead className="w-28 text-right">Kebutuhan</TableHead>
                      {showCosts ? <TableHead className="w-32 text-right">Harga</TableHead> : null}
                      {showCosts ? <TableHead className="w-36 text-right">Jumlah</TableHead> : null}
                      {canEdit ? <TableHead className="w-10" /> : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((line) => (
                      <TableRow
                        key={line.id}
                        className={canEdit ? 'cursor-pointer' : undefined}
                        onClick={canEdit ? () => setEditing(line) : undefined}
                      >
                        <TableCell className="font-mono text-xs">{line.resourceCode}</TableCell>
                        <TableCell>
                          {line.resourceName}
                          {line.resourceSpec ? (
                            <span className="block text-xs text-muted-foreground">
                              {line.resourceSpec}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{line.unitCode}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatCoefficient(line.coefRap)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                          {Number(line.wasteFactor) === 0
                            ? EMPTY_VALUE
                            : formatPercent(line.wasteFactor, 1)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatQuantity(line.qtyRap)}
                        </TableCell>
                        {showCosts ? (
                          <TableCell className="text-right font-mono tabular-nums">
                            {line.priceRap === null ? (
                              <span className="text-destructive">{EMPTY_VALUE}</span>
                            ) : (
                              formatCurrency(line.priceRap)
                            )}
                          </TableCell>
                        ) : null}
                        {showCosts ? (
                          <TableCell className="text-right font-mono tabular-nums">
                            {line.amountRap === null ? (
                              <span className="text-destructive">{EMPTY_VALUE}</span>
                            ) : (
                              formatCurrency(line.amountRap)
                            )}
                          </TableCell>
                        ) : null}
                        {canEdit ? (
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Hapus ${line.resourceName}`}
                              disabled={pending}
                              onClick={(e) => {
                                e.stopPropagation();
                                removeLine(line);
                              }}
                            >
                              <Trash2 className="size-4" aria-hidden />
                            </Button>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {showCosts && lines.length > 0 ? (
              <p className="text-right text-sm">
                <span className="text-muted-foreground">Jumlah {AHSP_ROLE_LABELS[role]}: </span>
                <span className="font-mono font-medium tabular-nums">
                  {formatCurrency(estimate.subtotalsRap[role])}
                </span>
              </p>
            ) : null}
          </section>
        );
      })}

      {showCosts ? (
        <div className="rounded-lg border bg-muted/30 p-4">
          <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            <Figure label={`Harga satuan RAB per ${unitCode}`} value={estimate.unitCostRab} />
            <Figure label={`Harga satuan RAP per ${unitCode}`} value={estimate.unitCostRap} />
            <Figure label="Selisih RAB − RAP" value={estimate.estimateSpread} />
            <Figure label="Total RAB" value={estimate.totalRab} strong />
            <Figure label="Total RAP" value={estimate.totalRap} strong />
            <Figure label="Nilai kontrak" value={estimate.contractValue} strong />
            <Figure label="Margin" value={estimate.margin} strong />
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">% Margin</dt>
              <dd className="mt-0.5 font-mono text-sm font-semibold tabular-nums">
                {estimate.marginPercent === null
                  ? EMPTY_VALUE
                  : formatPercent(estimate.marginPercent)}
              </dd>
            </div>
          </dl>
        </div>
      ) : null}

      {adding !== null ? (
        <AhspLineDialog
          open
          onOpenChange={(open) => !open && setAdding(null)}
          projectId={projectId}
          workItemId={workItemId}
          lineId={null}
          defaultRole={adding}
          resources={resources}
        />
      ) : null}

      {editing !== null ? (
        <AhspLineDialog
          open
          onOpenChange={(open) => !open && setEditing(null)}
          projectId={projectId}
          workItemId={workItemId}
          lineId={editing.id}
          defaultRole={editing.role}
          defaultValues={{
            resourceId: editing.resourceId,
            role: editing.role,
            coefRab: editing.coefRab,
            coefRap: editing.coefRap,
            wasteFactor: String(Number(editing.wasteFactor) * 100),
            note: editing.note ?? '',
            sortOrder: editing.sortOrder,
          }}
          resources={resources}
        />
      ) : null}
    </div>
  );
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  const negative = Number(value) < 0;
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd
        className={`mt-0.5 font-mono tabular-nums ${strong ? 'text-sm font-semibold' : 'text-sm'} ${
          negative ? 'text-destructive' : ''
        }`}
      >
        {formatCurrency(value)}
      </dd>
    </div>
  );
}

export function RoleBadge({ role }: { role: AhspRole }) {
  return (
    <Badge variant="secondary" className="text-[10px]">
      {AHSP_ROLE_LABELS[role]}
    </Badge>
  );
}
