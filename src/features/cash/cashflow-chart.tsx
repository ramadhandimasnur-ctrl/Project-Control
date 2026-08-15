'use client';

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { formatCurrencyCompact } from '@/lib/format';

/**
 * Money in, money out, and where the balance ends up.
 *
 * Bars carry each period's own movement and the line carries the running
 * balance, because the question is always both at once: what happened this
 * month, and can the project still pay for next month.
 *
 * The zero line is drawn explicitly. It is the only threshold that matters
 * here, and leaving the reader to infer it from the axis is how a project
 * discovers it is underwater one period late.
 */

export type CashflowPoint = {
  label: string;
  inflow: string;
  outflow: string;
  closing: string;
  isDeficit: boolean;
};

export function CashflowChart({ flow }: { flow: CashflowPoint[] }) {
  const data = flow.map((point) => ({
    label: point.label,
    masuk: Number(point.inflow),
    // Drawn downwards so inflow and outflow read as opposites at a glance.
    keluar: -Number(point.outflow),
    saldo: Number(point.closing),
  }));

  const hasDeficit = flow.some((point) => point.isDeficit);

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
            tickFormatter={(value: number) => formatCurrencyCompact(value)}
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
            tickLine={false}
            axisLine={false}
            width={72}
          />
          <Tooltip
            formatter={(value, name) => [
              formatCurrencyCompact(Math.abs(Number(value))),
              name === 'masuk' ? 'Masuk' : name === 'keluar' ? 'Keluar' : 'Saldo akhir',
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
              value === 'masuk' ? 'Masuk' : value === 'keluar' ? 'Keluar' : 'Saldo akhir'
            }
            wrapperStyle={{ fontSize: 12 }}
          />
          <ReferenceLine y={0} stroke="var(--border)" strokeWidth={1.5} />
          <Bar dataKey="masuk" fill="var(--primary)" opacity={0.75} radius={[3, 3, 0, 0]} />
          <Bar dataKey="keluar" fill="var(--muted-foreground)" opacity={0.5} radius={[0, 0, 3, 3]} />
          <Line
            type="monotone"
            dataKey="saldo"
            stroke={hasDeficit ? 'var(--destructive)' : 'var(--primary)'}
            strokeWidth={2.5}
            dot={{ r: 2 }}
            activeDot={{ r: 5 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
