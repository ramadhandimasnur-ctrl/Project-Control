'use client';

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/**
 * The planned S-curve.
 *
 * Bars carry each period's own share and the line carries the running total,
 * on one chart because the question a scheduler asks is always both at once:
 * how much this month, and where that leaves us.
 *
 * Values arrive as 0..1 fractions and are shown as percentages; the conversion
 * happens here so nothing upstream has to store a display scale.
 */

export type CurvePoint = {
  periodId: string;
  seq: number;
  label: string;
  plannedPct: string;
  cumulativePct: string;
  /** Realised cumulative, when progress has been recorded. */
  actualCumulative?: string | null;
};

const asPercent = (value: string): number => Number((Number(value) * 100).toFixed(4));

export function SCurveChart({ curve }: { curve: CurvePoint[] }) {
  const data = curve.map((point) => ({
    label: point.label,
    periode: asPercent(point.plannedPct),
    kumulatif: asPercent(point.cumulativePct),
    // Null rather than zero past the last report: a line that dives to the
    // axis reads as a collapse, when nothing has happened yet.
    realisasi:
      point.actualCumulative === undefined || point.actualCumulative === null
        ? null
        : asPercent(point.actualCumulative),
  }));

  const hasActual = data.some((d) => d.realisasi !== null);
  const peak = Math.max(100, ...data.map((d) => Math.max(d.kumulatif, d.realisasi ?? 0)));

  return (
    <div className="h-96 w-full rounded-lg border p-4">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
            tickLine={false}
            axisLine={{ stroke: 'var(--border)' }}
            interval="preserveStartEnd"
            minTickGap={16}
          />
          <YAxis
            domain={[0, Math.ceil(peak / 10) * 10]}
            tickFormatter={(value: number) => `${value}%`}
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
            tickLine={false}
            axisLine={false}
            width={48}
          />
          <Tooltip
            formatter={(value, name) => [
              `${Number(Number(value).toFixed(2))}%`,
              name === 'periode' ? 'Porsi periode' : name === 'realisasi' ? 'Realisasi' : 'Rencana',
            ]}
            contentStyle={{
              background: 'var(--popover)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              fontSize: 12,
              color: 'var(--popover-foreground)',
            }}
          />
          <Legend
            formatter={(value: string) =>
              value === 'periode' ? 'Porsi periode' : value === 'realisasi' ? 'Realisasi' : 'Rencana'
            }
            wrapperStyle={{ fontSize: 12 }}
          />
          <Bar dataKey="periode" fill="var(--muted-foreground)" opacity={0.35} radius={[3, 3, 0, 0]} />
          <Line
            type="monotone"
            dataKey="kumulatif"
            stroke="var(--muted-foreground)"
            strokeWidth={2}
            strokeDasharray="5 4"
            dot={false}
            activeDot={{ r: 4 }}
          />
          {hasActual ? (
            <Line
              type="monotone"
              dataKey="realisasi"
              stroke="var(--primary)"
              strokeWidth={2.5}
              dot={{ r: 2 }}
              activeDot={{ r: 5 }}
              connectNulls={false}
            />
          ) : null}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
