'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface FunnelRow {
  period: string;
  messages_in: number;
  checkouts_created: number;
  payments_verified: number;
}

// Aggregate funnel across periods into a single summary
function aggregateFunnel(data: FunnelRow[]): { stage: string; count: number }[] {
  const totals = data.reduce(
    (acc, row) => ({
      messages: acc.messages + row.messages_in,
      checkouts: acc.checkouts + row.checkouts_created,
      payments: acc.payments + row.payments_verified,
    }),
    { messages: 0, checkouts: 0, payments: 0 }
  );

  return [
    { stage: 'Messages', count: totals.messages },
    { stage: 'Checkouts', count: totals.checkouts },
    { stage: 'Payments', count: totals.payments },
  ];
}

export function FunnelChart({ data }: { data: FunnelRow[] }) {
  const chartData = aggregateFunnel(data);

  if (chartData.every(d => d.count === 0)) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Conversion Funnel</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="stage" tick={{ fontSize: 12 }} className="fill-muted-foreground" />
            <YAxis tick={{ fontSize: 12 }} className="fill-muted-foreground" />
            <Tooltip
              contentStyle={{
                backgroundColor: 'var(--color-card)',
                borderColor: 'var(--color-border)',
                borderRadius: '8px',
                color: 'var(--color-card-foreground)',
              }}
            />
            <Bar dataKey="count" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
