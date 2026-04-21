'use client';

import { useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';
import { getFunnel, getProducts, getAICost, getUsage } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { timeAgo } from '@/lib/utils';

export default function AnalyticsPage() {
  const { auth } = useAuth();
  const clientId = auth?.role === 'client' ? auth.clientId! : undefined;

  const usageFetcher = useCallback(
    () => auth ? getUsage(auth.key, clientId, 3) : Promise.resolve([]),
    [auth, clientId]
  );
  const aiCostFetcher = useCallback(
    () => auth ? getAICost(auth.key, clientId, 3) : Promise.resolve([]),
    [auth, clientId]
  );

  const { data: usage, lastUpdated } = useAutoRefresh(usageFetcher);
  const { data: aiCost } = useAutoRefresh(aiCostFetcher);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Analytics</h1>
        {lastUpdated && <span className="text-xs text-muted-foreground">Updated {timeAgo(lastUpdated)}</span>}
      </div>

      {/* Usage table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Usage Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                {auth?.role === 'owner' && <TableHead>Client</TableHead>}
                <TableHead className="text-right">Messages</TableHead>
                <TableHead className="text-right">AI Calls</TableHead>
                <TableHead className="text-right">Checkouts</TableHead>
                <TableHead className="text-right">Payments</TableHead>
                <TableHead className="text-right">Escalations</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(usage || []).map((u, i) => (
                <TableRow key={i}>
                  <TableCell>{u.period}</TableCell>
                  {auth?.role === 'owner' && <TableCell>{u.client_name}</TableCell>}
                  <TableCell className="text-right">{u.messages_in}</TableCell>
                  <TableCell className="text-right">{u.ai_calls}</TableCell>
                  <TableCell className="text-right">{u.checkouts}</TableCell>
                  <TableCell className="text-right">{u.payments}</TableCell>
                  <TableCell className="text-right">{u.escalations}</TableCell>
                </TableRow>
              ))}
              {(!usage || usage.length === 0) && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">No data</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* AI Cost table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">AI Cost</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Calls</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead className="text-right">Avg Latency (ms)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(aiCost || []).map((c, i) => (
                <TableRow key={i}>
                  <TableCell>{c.period}</TableCell>
                  <TableCell className="text-right">{c.total_calls}</TableCell>
                  <TableCell className="text-right">{c.total_tokens.toLocaleString()}</TableCell>
                  <TableCell className="text-right">{c.avg_duration_ms}</TableCell>
                </TableRow>
              ))}
              {(!aiCost || aiCost.length === 0) && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">No data</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
