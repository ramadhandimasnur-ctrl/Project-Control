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
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  EMPTY_VALUE,
  formatCoefficient,
  formatCurrency,
  formatPercent,
  formatQuantity,
} from '@/lib/format';
import {
  AHSP_ROLE_LABELS,
  AHSP_ROLE_ORDER,
  ESTIMATE_TYPE_CAPTIONS,
  ESTIMATE_TYPE_LABELS,
} from '@/lib/validation/work-breakdown';
import type {
  AhspLineView,
  AhspRole,
  EstimateType,
  WorkItemEstimateView,
} from '@/services/ahsp';

import { deleteAhspLineAction } from './actions';
import { AhspLineDialog } from './ahsp-line-dialog';
import { safeDivide, toDecimal } from '@/lib/calc/decimal';

/**
 * The right-hand panel: one work item's two analyses.
 *
 * RAB and RAP are separate documents rather than two columns of one. They may
 * name different resources entirely — a budget priced on site-batched concrete
 * against an execution plan that buys ready-mix — and the earlier shared row
 * could only express that as zero-coefficient lines cluttering both sheets.
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
  estimate,
  resources,
  canEdit,
  showCosts,
}: {
  projectId: string;
  workItemId: string;
  workItemCode: string;
  workItemName: string;
  estimate: WorkItemEstimateView;
  resources: { id: string; code: string; name: string; spec: string | null; unitCode: string }[];
  canEdit: boolean;
  showCosts: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<AhspLineView | null>(null);
  const [adding, setAdding] = useState<{ role: AhspRole; estimateType: EstimateType } | null>(null);
  const [pending, startTransition] = useTransition();

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
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-3">
        <div>
          <p className="font-mono text-xs text-muted-foreground">{workItemCode}</p>
          <h2 className="text-lg font-semibold">{workItemName}</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Volume {formatQuantity(estimate.volume)} {estimate.unitCode}
          {estimate.volumeRap === estimate.volume && estimate.unitCodeRap === estimate.unitCode
            ? ''
            : ` · RAP ${formatQuantity(estimate.volumeRap)} ${estimate.unitCodeRap}`}
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
            <p className="mt-2">Tambahkan di Master Data → Sumber Daya.</p>
          </AlertDescription>
        </Alert>
      ) : null}

      {(['RAB', 'RAP'] as const).map((estimateType) => (
        <AnalysisSection
          key={estimateType}
          estimateType={estimateType}
          lines={estimate.lines.filter((line) => line.estimateType === estimateType)}
          subtotals={estimate.subtotals[estimateType]}
          unitCost={estimateType === 'RAB' ? estimate.unitCostRab : estimate.unitCostRap}
          volume={estimateType === 'RAB' ? estimate.volume : estimate.volumeRap}
          total={estimateType === 'RAB' ? estimate.totalRab : estimate.totalRap}
          unitCode={estimateType === 'RAB' ? estimate.unitCode : estimate.unitCodeRap}
          canEdit={canEdit}
          showCosts={showCosts}
          pending={pending}
          onAdd={(role) => setAdding({ role, estimateType })}
          onEdit={setEditing}
          onRemove={removeLine}
        />
      ))}

      {/*
        A unit rate with no analysis under it would otherwise be a number with
        no visible origin, which is exactly what this system exists to avoid.
        Say where it came from.
      */}
      {showCosts &&
      estimate.lines.length === 0 &&
      (Number(estimate.unitCostRab) > 0 || Number(estimate.unitCostRap) > 0) ? (
        <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
          Pekerjaan ini belum punya baris analisa, jadi harga satuan di bawah diambil dari harga
          langsung yang diketik pada form pekerjaan. Begitu baris analisa ditambahkan, angkanya
          dihitung dari analisa itu dan harga langsung diabaikan.
        </p>
      ) : null}

      {/*
        Two blocks rather than one eight-cell grid. Per-unit and whole-item
        figures are different orders of magnitude, and mixing them made it easy
        to read a unit rate as a total.
      */}
      {showCosts ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-lg border p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Per satuan
            </p>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
              <Figure
                label={`Harga satuan RAB / ${estimate.unitCode}`}
                value={estimate.unitCostRab}
              />
              <Figure
                label={`Harga satuan RAP / ${estimate.unitCodeRap}`}
                value={estimate.unitCostRap}
              />
              {/*
                Only comparable when both sides measure the same way. A rate
                per compacted m3 minus a rate per truckload is a number with no
                meaning, and printing it invites someone to act on it.
              */}
              {estimate.unitCodeRap === estimate.unitCode ? (
                <Figure label="Selisih" value={estimate.estimateSpread} />
              ) : (
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">Selisih</dt>
                  <dd className="mt-0.5 text-xs text-muted-foreground">
                    Satuan RAB dan RAP berbeda, jadi harga satuannya tidak dibandingkan langsung.
                  </dd>
                </div>
              )}
            </dl>
          </div>

          <div className="rounded-lg border bg-muted/30 p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Total pekerjaan · volume {formatQuantity(estimate.volume)} {estimate.unitCode}
            </p>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Figure label="Total RAB" value={estimate.totalRab} strong />
              <Figure label="Total RAP" value={estimate.totalRap} strong />
              <Figure label="Nilai kontrak" value={estimate.contractValue} strong />
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Margin</dt>
                <dd
                  className={`mt-0.5 font-mono text-sm font-semibold tabular-nums ${
                    Number(estimate.margin) < 0 ? 'text-destructive' : ''
                  }`}
                >
                  {formatCurrency(estimate.margin)}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {estimate.marginPercent === null
                      ? EMPTY_VALUE
                      : formatPercent(estimate.marginPercent)}
                  </span>
                </dd>
              </div>
            </dl>
          </div>
        </div>
      ) : null}

      {/*
        Adding a line, from where a thumb can reach.

        It opens on RAB/Bahan rather than asking first: the dialog's own two
        selects are the place to change either, and a menu in front of a form
        that already asks the same question is one tap of ceremony for nothing.
        Above the sheet's own layer, since this floats inside it.
      */}
      {canEdit ? (
        <Button
          aria-label="Tambah baris analisa"
          className="fixed bottom-5 right-5 z-[60] size-14 rounded-full shadow-lg lg:hidden"
          onClick={() => setAdding({ role: 'MATERIAL', estimateType: 'RAB' })}
        >
          <Plus className="size-6" aria-hidden />
        </Button>
      ) : null}

      {adding !== null ? (
        <AhspLineDialog
          open
          onOpenChange={(open) => !open && setAdding(null)}
          projectId={projectId}
          workItemId={workItemId}
          lineId={null}
          defaultRole={adding.role}
          defaultEstimateType={adding.estimateType}
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
          defaultEstimateType={editing.estimateType}
          defaultValues={{
            resourceId: editing.resourceId,
            estimateType: editing.estimateType,
            role: editing.role,
            coef: editing.coef,
            wasteFactor: String(Number(editing.wasteFactor) * 100),
            qty: editing.qtyTyped ?? '',
            note: editing.note ?? '',
            sortOrder: editing.sortOrder,
          }}
          resources={resources}
        />
      ) : null}
    </div>
  );
}

/**
 * One of the two analyses, grouped into the sections the source workbook uses
 * (A TENAGA / B BAHAN / C ALAT / D SUBKON / E PAKET).
 */
function AnalysisSection({
  estimateType,
  lines,
  subtotals,
  unitCost,
  volume,
  total,
  unitCode,
  canEdit,
  showCosts,
  pending,
  onAdd,
  onEdit,
  onRemove,
}: {
  estimateType: EstimateType;
  lines: AhspLineView[];
  subtotals: Record<AhspRole, string>;
  unitCost: string;
  volume: string;
  total: string;
  unitCode: string;
  canEdit: boolean;
  showCosts: boolean;
  pending: boolean;
  onAdd: (role: AhspRole) => void;
  onEdit: (line: AhspLineView) => void;
  onRemove: (line: AhspLineView) => void;
}) {
  const byRole = new Map<AhspRole, AhspLineView[]>();
  for (const role of AHSP_ROLE_ORDER) byRole.set(role, []);
  for (const line of lines) byRole.get(line.role)?.push(line);

  /*
   * What the coefficient would have been, for a line written as a quantity.
   * Presentation only — the figure the money is built from is computed in
   * `lib/calc/estimate`, and this must never become a second source for it.
   */
  const derivedCoefficient = (qty: string, onVolume: string): string =>
    (safeDivide(qty, onVolume) ?? toDecimal(0)).toString();

  const emptyRoles = AHSP_ROLE_ORDER.filter((role) => (byRole.get(role) ?? []).length === 0);

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{ESTIMATE_TYPE_LABELS[estimateType]}</h3>
          <p className="text-xs text-muted-foreground">{ESTIMATE_TYPE_CAPTIONS[estimateType]}</p>
        </div>
        {showCosts ? (
          <p className="text-sm">
            <span className="font-mono font-semibold tabular-nums">{formatCurrency(unitCost)}</span>
            <span className="text-xs text-muted-foreground"> / {unitCode}</span>
            <span className="ml-3 text-xs text-muted-foreground">
              × {formatQuantity(volume)} = {formatCurrency(total)}
            </span>
          </p>
        ) : null}
      </div>

      {lines.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
          Belum ada baris pada {ESTIMATE_TYPE_LABELS[estimateType]}.
        </p>
      ) : null}

      {AHSP_ROLE_ORDER.map((role) => {
        const roleLines = byRole.get(role) ?? [];
        if (roleLines.length === 0) return null;

        return (
          <div key={role} className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium">
                {AHSP_ROLE_LABELS[role]}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {roleLines.length} baris
                </span>
              </h4>
              {canEdit ? (
                <Button variant="ghost" size="sm" onClick={() => onAdd(role)}>
                  <Plus className="size-4" aria-hidden />
                  Tambah baris
                </Button>
              ) : null}
            </div>

            {/*
              A phone gets the same figures stacked instead of a table.
              Eight columns on a 390px screen either scroll sideways — where
              the amounts sit, out of sight — or shrink until the numbers are
              unreadable. Neither is a table anybody can check.
            */}
            <ul className="space-y-2 lg:hidden">
              {roleLines.map((line) => (
                <li key={line.id}>
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={canEdit ? () => onEdit(line) : undefined}
                    className="w-full rounded-lg border p-3 text-left transition-colors enabled:hover:bg-accent/40"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-xs text-muted-foreground">
                        {line.resourceCode}
                      </span>
                      {showCosts ? (
                        <span className="font-mono text-sm font-semibold tabular-nums">
                          {line.amount === null ? (
                            <span className="text-destructive">{EMPTY_VALUE}</span>
                          ) : (
                            formatCurrency(line.amount)
                          )}
                        </span>
                      ) : null}
                    </div>

                    <p className="mt-0.5 font-medium">{line.resourceName}</p>
                    {line.resourceSpec ? (
                      <p className="text-xs text-muted-foreground">{line.resourceSpec}</p>
                    ) : null}

                    {/* Coefficient, unit and base price, read top to bottom. */}
                    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      <Detail
                        label="Koefisien"
                        value={formatCoefficient(
                          line.qtyTyped === null
                            ? line.coef
                            : derivedCoefficient(line.qty, volume),
                        )}
                      />
                      <Detail label="Satuan" value={line.unitCode} />
                      <Detail
                        label="Susut"
                        value={
                          Number(line.wasteFactor) === 0
                            ? EMPTY_VALUE
                            : formatPercent(line.wasteFactor, 1)
                        }
                      />
                      <Detail
                        label={line.qtyTyped === null ? 'Kebutuhan' : 'Kebutuhan (diisi langsung)'}
                        value={formatQuantity(line.qty)}
                      />
                      {showCosts ? (
                        <Detail
                          label="Harga dasar"
                          value={line.price === null ? EMPTY_VALUE : formatCurrency(line.price)}
                          alert={line.price === null}
                        />
                      ) : null}
                    </dl>
                  </button>
                </li>
              ))}
            </ul>

            {showCosts ? (
              <p className="flex items-baseline justify-between rounded-md bg-muted/50 px-3 py-2 text-sm lg:hidden">
                <span>Jumlah {AHSP_ROLE_LABELS[role]}</span>
                <span className="font-mono font-semibold tabular-nums">
                  {formatCurrency(subtotals[role])}
                </span>
              </p>
            ) : null}

            <div className="hidden w-full rounded-lg border lg:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    {/*
                      Five columns, not eight.

                      Code, unit and waste each had a column of their own, and
                      together they pushed Harga and Jumlah off the right edge —
                      the two figures the sheet exists to show. Each has been
                      folded into the column it qualifies: the code above the
                      name, the unit after the quantity, the waste beside the
                      coefficient it multiplies. Nothing is lost, and the money
                      is on screen without reaching for a scrollbar.
                    */}
                    <TableHead className="min-w-48">Uraian</TableHead>
                    <TableHead className="w-28 text-right">Koef</TableHead>
                    <TableHead className="w-32 text-right">Kebutuhan</TableHead>
                    {showCosts ? <TableHead className="w-32 text-right">Harga</TableHead> : null}
                    {showCosts ? <TableHead className="w-36 text-right">Jumlah</TableHead> : null}
                    {canEdit ? <TableHead className="w-10" /> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {roleLines.map((line) => (
                    <TableRow
                      key={line.id}
                      className={canEdit ? 'cursor-pointer' : undefined}
                      onClick={canEdit ? () => onEdit(line) : undefined}
                    >
                      <TableCell>
                        <span className="block font-mono text-xs text-muted-foreground">
                          {line.resourceCode}
                        </span>
                        {line.resourceName}
                        {line.resourceSpec ? (
                          <span className="block text-xs text-muted-foreground">
                            {line.resourceSpec}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {line.qtyTyped === null ? (
                          <>
                            {formatCoefficient(line.coef)}
                            {/* The waste sits with the coefficient it multiplies. */}
                            {Number(line.wasteFactor) === 0 ? null : (
                              <span className="block text-xs text-muted-foreground">
                                susut {formatPercent(line.wasteFactor, 1)}
                              </span>
                            )}
                          </>
                        ) : (
                          /*
                           * Derived, and shown as such. A sheet printed for
                           * tender is still expected to carry a coefficient
                           * per line, so the figure is not simply dropped —
                           * but it follows the quantity here rather than
                           * producing it, and reads muted to say so.
                           */
                          <span className="text-muted-foreground">
                            {formatCoefficient(derivedCoefficient(line.qty, volume))}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatQuantity(line.qty)}
                        <span className="ml-1 text-xs text-muted-foreground">{line.unitCode}</span>
                        {line.qtyTyped === null ? null : (
                          <span className="block text-xs text-muted-foreground">diisi langsung</span>
                        )}
                      </TableCell>
                      {showCosts ? (
                        <TableCell className="text-right font-mono tabular-nums">
                          {line.price === null ? (
                            <span className="text-destructive">{EMPTY_VALUE}</span>
                          ) : (
                            formatCurrency(line.price)
                          )}
                        </TableCell>
                      ) : null}
                      {showCosts ? (
                        <TableCell className="text-right font-mono tabular-nums">
                          {line.amount === null ? (
                            <span className="text-destructive">{EMPTY_VALUE}</span>
                          ) : (
                            formatCurrency(line.amount)
                          )}
                        </TableCell>
                      ) : null}
                      {canEdit ? (
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Hapus ${line.resourceName} dari ${ESTIMATE_TYPE_LABELS[estimateType]}`}
                            disabled={pending}
                            onClick={(e) => {
                              e.stopPropagation();
                              onRemove(line);
                            }}
                          >
                            <Trash2 className="size-4" aria-hidden />
                          </Button>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>

                {/*
                  The subtotal sits under the column it sums instead of
                  floating as a line of prose beneath the table — that is
                  where a reader checking an AHSP sheet looks for it.
                */}
                {showCosts ? (
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={3}>Jumlah {AHSP_ROLE_LABELS[role]}</TableCell>
                      <TableCell />
                      <TableCell className="text-right font-mono font-medium tabular-nums">
                        {formatCurrency(subtotals[role])}
                      </TableCell>
                      {canEdit ? <TableCell /> : null}
                    </TableRow>
                  </TableFooter>
                ) : null}
              </Table>
            </div>
          </div>
        );
      })}

      {/*
        Empty sections collapse into one row of buttons instead of five dashed
        boxes. On an analysis with nothing in it yet the old layout was almost
        entirely empty placeholders, which buried the sections that did have
        content.
      */}
      {canEdit && emptyRoles.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed px-3 py-2">
          <span className="text-xs text-muted-foreground">Bagian yang belum diisi:</span>
          {emptyRoles.map((role) => (
            <Button key={role} variant="ghost" size="sm" onClick={() => onAdd(role)}>
              <Plus className="size-3.5" aria-hidden />
              {AHSP_ROLE_LABELS[role]}
            </Button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/** One labelled figure inside a mobile analysis card. */
function Detail({
  label,
  value,
  alert,
}: {
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={`font-mono tabular-nums ${alert ? 'text-destructive' : ''}`}
      >
        {value}
      </dd>
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
