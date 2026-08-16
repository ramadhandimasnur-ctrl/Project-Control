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
  ESTIMATE_TYPE_LABELS,
} from '@/lib/validation/work-breakdown';
import type { AhspLineView, AhspRole, EstimateType, WorkItemAnalyses } from '@/services/ahsp';

/**
 * One work item's two analyses, laid out for paper.
 *
 * RAB and RAP print one after the other in a single document rather than as
 * two files. They are read against each other — the question a reader has in
 * front of an AHSP sheet is what the gap between them is and where it comes
 * from — and two separate exports make that comparison a stapling exercise.
 *
 * A server component: nothing here is interactive, and rendering it on the
 * client would ship the whole price book to the browser to produce a page that
 * never changes after it loads.
 */
export function AhspPrintSheet({
  item,
  showCosts,
  pageBreak,
}: {
  item: WorkItemAnalyses;
  showCosts: boolean;
  /** Every item after the first starts its own sheet. */
  pageBreak: boolean;
}) {
  return (
    <section
      data-print={pageBreak ? 'page-break' : undefined}
      className="space-y-4 border-t pt-6 first:border-t-0 first:pt-0"
    >
      <header className="space-y-0.5">
        <p className="font-mono text-xs text-muted-foreground">
          {item.code}
          {item.groupName ? ` · ${item.groupName}` : ''}
        </p>
        <h2 className="text-base font-semibold">{item.name}</h2>
        {item.spec ? <p className="text-xs text-muted-foreground">{item.spec}</p> : null}
        <p className="text-xs text-muted-foreground">
          Volume RAB {formatQuantity(item.volume)} {item.unitCode}
          {item.volumeRap === item.volume && item.unitCodeRap === item.unitCode
            ? ''
            : ` · Volume RAP ${formatQuantity(item.volumeRap)} ${item.unitCodeRap}`}
        </p>
      </header>

      {(['RAB', 'RAP'] as const).map((estimateType) => (
        <AnalysisTable
          key={estimateType}
          estimateType={estimateType}
          lines={item.lines.filter((line) => line.estimateType === estimateType)}
          subtotals={item.subtotals[estimateType]}
          unitCost={estimateType === 'RAB' ? item.unitCostRab : item.unitCostRap}
          unitCode={estimateType === 'RAB' ? item.unitCode : item.unitCodeRap}
          showCosts={showCosts}
        />
      ))}

      {showCosts ? (
        <div data-print="keep-together" className="rounded-md border p-3 text-sm">
          <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-3">
            <Pair label={`Harga satuan RAB / ${item.unitCode}`} value={item.unitCostRab} />
            <Pair label={`Harga satuan RAP / ${item.unitCodeRap}`} value={item.unitCostRap} />
            {/*
              Unit rates are only comparable when both sides measure the same
              way. Totals always are — they are money for the whole item — so
              the difference below stays whatever the units.
            */}
            {item.unitCodeRap === item.unitCode ? (
              <Pair
                label="Selisih RAB − RAP"
                value={(Number(item.unitCostRab) - Number(item.unitCostRap)).toFixed(2)}
              />
            ) : (
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-xs text-muted-foreground">Selisih harga satuan</dt>
                <dd className="text-xs text-muted-foreground">satuan berbeda</dd>
              </div>
            )}
            <Pair label="Total RAB" value={item.totalRab} />
            <Pair label="Total RAP" value={item.totalRap} />
            <Pair
              label="Selisih total"
              value={(Number(item.totalRab) - Number(item.totalRap)).toFixed(2)}
            />
          </dl>
        </div>
      ) : null}
    </section>
  );
}

function AnalysisTable({
  estimateType,
  lines,
  subtotals,
  unitCost,
  unitCode,
  showCosts,
}: {
  estimateType: EstimateType;
  lines: AhspLineView[];
  subtotals: Record<AhspRole, string>;
  unitCost: string;
  unitCode: string;
  showCosts: boolean;
}) {
  const byRole = new Map<AhspRole, AhspLineView[]>();
  for (const role of AHSP_ROLE_ORDER) byRole.set(role, []);
  for (const line of lines) byRole.get(line.role)?.push(line);

  return (
    <div data-print="keep-together" className="space-y-1">
      <h3 className="text-sm font-semibold">{ESTIMATE_TYPE_LABELS[estimateType]}</h3>

      {lines.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-3 text-center text-xs text-muted-foreground">
          Tidak ada baris pada analisa ini.
        </p>
      ) : (
        <div className="w-full rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Kode</TableHead>
                <TableHead>Uraian</TableHead>
                <TableHead className="w-14">Sat</TableHead>
                <TableHead className="w-20 text-right">Koef</TableHead>
                <TableHead className="w-16 text-right">Susut</TableHead>
                <TableHead className="w-24 text-right">Kebutuhan</TableHead>
                {showCosts ? <TableHead className="w-28 text-right">Harga</TableHead> : null}
                {showCosts ? <TableHead className="w-32 text-right">Jumlah</TableHead> : null}
              </TableRow>
            </TableHeader>

            {AHSP_ROLE_ORDER.map((role) => {
              const roleLines = byRole.get(role) ?? [];
              if (roleLines.length === 0) return null;

              return (
                <TableBody key={role}>
                  <TableRow>
                    <TableCell colSpan={showCosts ? 8 : 6} className="bg-muted/50 font-medium">
                      {AHSP_ROLE_LABELS[role]}
                    </TableCell>
                  </TableRow>

                  {roleLines.map((line) => (
                    <TableRow key={line.id}>
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
                        {formatCoefficient(line.coef)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                        {Number(line.wasteFactor) === 0
                          ? EMPTY_VALUE
                          : formatPercent(line.wasteFactor, 1)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatQuantity(line.qty)}
                      </TableCell>
                      {showCosts ? (
                        <TableCell className="text-right font-mono tabular-nums">
                          {line.price === null ? EMPTY_VALUE : formatCurrency(line.price)}
                        </TableCell>
                      ) : null}
                      {showCosts ? (
                        <TableCell className="text-right font-mono tabular-nums">
                          {line.amount === null ? EMPTY_VALUE : formatCurrency(line.amount)}
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}

                  {showCosts ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-right text-xs">
                        Jumlah {AHSP_ROLE_LABELS[role]}
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium tabular-nums">
                        {formatCurrency(subtotals[role])}
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              );
            })}

            {showCosts ? (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={7} className="text-right">
                    Harga satuan {estimateType} per {unitCode}
                  </TableCell>
                  <TableCell className="text-right font-mono font-semibold tabular-nums">
                    {formatCurrency(unitCost)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            ) : null}
          </Table>
        </div>
      )}
    </div>
  );
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono text-sm tabular-nums">{formatCurrency(value)}</dd>
    </div>
  );
}
