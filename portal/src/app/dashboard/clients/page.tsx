'use client';

import { useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';
import { getClients } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { formatCurrency, timeAgo } from '@/lib/utils';

export default function ClientsPage() {
  const { auth } = useAuth();

  const fetcher = useCallback(
    () => auth?.role === 'owner' ? getClients(auth.key) : Promise.resolve([]),
    [auth]
  );
  const { data: clients, lastUpdated } = useAutoRefresh(fetcher);

  if (auth?.role !== 'owner') {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Owner access only.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Clients</h1>
        {lastUpdated && <span className="text-xs text-muted-foreground">Updated {timeAgo(lastUpdated)}</span>}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active Clients</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Industry</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Monthly Messages</TableHead>
                <TableHead className="text-right">Monthly Revenue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(clients || []).map(c => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell>{c.industry}</TableCell>
                  <TableCell>
                    <Badge variant={c.active ? 'default' : 'secondary'}>
                      {c.active ? 'active' : 'inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">{c.monthly_messages}</TableCell>
                  <TableCell className="text-right">{formatCurrency(c.monthly_revenue)}</TableCell>
                </TableRow>
              ))}
              {(!clients || clients.length === 0) && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">No clients</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
