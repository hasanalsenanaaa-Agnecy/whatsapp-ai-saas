'use client';

import { useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';
import { getRevenue, getUsage, getFunnel, getHealth } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RevenueChart } from '@/components/revenue-chart';
import { FunnelChart } from '@/components/funnel-chart';
import { formatCurrency, timeAgo } from '@/lib/utils';

export default function OverviewPage() {
  const { auth } = useAuth();

  const revenueFetcher = useCallback(
    () => auth ? getRevenue(auth.key, auth.role === 'client' ? auth.clientId : undefined, 3) : Promise.resolve([]),
    [auth]
  );
  const usageFetcher = useCallback(
    () => auth ? getUsage(auth.key, auth.role === 'client' ? auth.clientId : undefined, 1) : Promise.resolve([]),
    [auth]
  );
  const funnelFetcher = useCallback(
    () => {
      if (!auth) return Promise.resolve([]);
      // Funnel requires a client_id. For owner, grab first client from revenue or skip.
      const clientId = auth.role === 'client' ? auth.clientId : undefined;
      if (!clientId) return Promise.resolve([]);
      return getFunnel(auth.key, clientId, 3);
    },
    [auth]
  );
  const healthFetcher = useCallback(() => getHealth(), []);

  const { data: revenue, lastUpdated } = useAutoRefresh(revenueFetcher);
  const { data: usage } = useAutoRefresh(usageFetcher);
  const { data: funnel } = useAutoRefresh(funnelFetcher);
  const { data: health } = useAutoRefresh(healthFetcher);

  // Aggregate KPIs from this month's data
  const thisMonth = new Date().toISOString().slice(0, 7);
  const monthRevenue = revenue?.filter(r => r.period === thisMonth) || [];
  const totalRevenue = monthRevenue.reduce((sum, r) => sum + r.total_revenue, 0);
  const totalOrders = monthRevenue.reduce((sum, r) => sum + r.order_count, 0);
  const currency = monthRevenue[0]?.currency || 'SAR';

  const monthUsage = usage?.filter(u => u.period === thisMonth) || [];
  const totalMessages = monthUsage.reduce((sum, u) => sum + u.messages_in, 0);
  const totalCheckouts = monthUsage.reduce((sum, u) => sum + u.checkouts, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Overview</h1>
        <div className="flex items-center gap-3">
          {health && (
            <Badge variant={health.status === 'healthy' ? 'default' : 'destructive'}>
              {health.status}
            </Badge>
          )}
          {lastUpdated && (
            <span className="text-xs text-muted-foreground">
              Updated {timeAgo(lastUpdated)}
            </span>
          )}
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Revenue (this month)" value={formatCurrency(totalRevenue, currency)} />
        <KpiCard title="Orders" value={String(totalOrders)} />
        <KpiCard title="Messages" value={String(totalMessages)} />
        <KpiCard title="Checkouts" value={String(totalCheckouts)} />
      </div>

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        {revenue && revenue.length > 0 && <RevenueChart data={revenue} />}
        {funnel && funnel.length > 0 && <FunnelChart data={funnel} />}
      </div>
    </div>
  );
}

function KpiCard({ title, value }: { title: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}
