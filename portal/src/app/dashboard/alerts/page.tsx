'use client';

import { useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';
import { getAlerts } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { timeAgo } from '@/lib/utils';

export default function AlertsPage() {
  const { auth } = useAuth();

  const fetcher = useCallback(
    () => auth ? getAlerts(auth.key, auth.role === 'client' ? auth.clientId : undefined) : Promise.resolve([]),
    [auth]
  );
  const { data: alerts, lastUpdated } = useAutoRefresh(fetcher);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Alerts</h1>
        {lastUpdated && <span className="text-xs text-muted-foreground">Updated {timeAgo(lastUpdated)}</span>}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Errors</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {(alerts || []).map((alert, i) => (
              <div key={i} className="flex items-start gap-3 border-b pb-3 last:border-0">
                <Badge variant="destructive" className="mt-0.5 shrink-0">error</Badge>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{alert.client_name}</span>
                    <span className="text-xs text-muted-foreground">{timeAgo(alert.created_at)}</span>
                  </div>
                  <p className="mt-0.5 truncate text-sm text-muted-foreground">
                    {alert.data?.error || alert.data?.message || 'Unknown error'}
                  </p>
                </div>
              </div>
            ))}
            {(!alerts || alerts.length === 0) && (
              <p className="text-sm text-muted-foreground">No alerts. All clear.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
