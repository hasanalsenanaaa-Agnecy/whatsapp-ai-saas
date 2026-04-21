'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';
import { getConversations, getConversationDetail, sendMessage, getClients } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { maskPhone, timeAgo, cn } from '@/lib/utils';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const STATES = ['', 'shopify', 'lead_qualification', 'appointment', 'complete', 'idle'];
const STATE_LABELS: Record<string, string> = {
  '': 'All states',
  shopify: 'Shopify',
  lead_qualification: 'Lead Qual',
  appointment: 'Appointment',
  complete: 'Complete',
  idle: 'Idle',
};

export default function ConversationsPage() {
  const { auth } = useAuth();
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);

  // Filters
  const [filterClient, setFilterClient] = useState('');
  const [filterState, setFilterState] = useState('');
  const [page, setPage] = useState(1);
  const [clients, setClients] = useState<any[]>([]);

  // Load client list for owner filter dropdown
  useEffect(() => {
    if (auth?.role === 'owner') {
      getClients(auth.key).then(setClients).catch(() => {});
    }
  }, [auth]);

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [filterClient, filterState]);

  const fetcher = useCallback(
    () => {
      if (!auth) return Promise.resolve({ conversations: [], total: 0 });
      const clientId = auth.role === 'client' ? auth.clientId : (filterClient || undefined);
      return getConversations(auth.key, {
        clientId,
        state: filterState || undefined,
        page,
      });
    },
    [auth, filterClient, filterState, page]
  );
  const { data, lastUpdated } = useAutoRefresh(fetcher);

  async function selectConversation(phone: string, clientId: string) {
    if (!auth) return;
    setSelectedPhone(phone);
    setSelectedClientId(clientId);
    const d = await getConversationDetail(auth.key, phone, clientId);
    setDetail(d);
  }

  async function handleSend() {
    if (!auth || !selectedPhone || !selectedClientId || !messageText.trim()) return;
    setSending(true);
    try {
      await sendMessage(auth.key, selectedPhone, selectedClientId, messageText.trim());
      setMessageText('');
      const d = await getConversationDetail(auth.key, selectedPhone, selectedClientId);
      setDetail(d);
    } catch {
      // silently fail
    } finally {
      setSending(false);
    }
  }

  const conversations = data?.conversations || [];
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / 20));

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      {/* Left: conversation list */}
      <Card className="flex w-80 flex-shrink-0 flex-col">
        <CardHeader className="space-y-3 pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Conversations ({total})</CardTitle>
            {lastUpdated && <span className="text-xs text-muted-foreground">{timeAgo(lastUpdated)}</span>}
          </div>

          {/* Filters */}
          <div className="flex gap-2">
            {auth?.role === 'owner' && (
              <Select value={filterClient} onValueChange={(v) => setFilterClient(v ?? '')}>
                <SelectTrigger size="sm">
                  <SelectValue placeholder="All clients" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All clients</SelectItem>
                  {clients.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={filterState} onValueChange={(v) => setFilterState(v ?? '')}>
              <SelectTrigger size="sm">
                <SelectValue placeholder="All states" />
              </SelectTrigger>
              <SelectContent>
                {STATES.map(s => (
                  <SelectItem key={s} value={s}>{STATE_LABELS[s] || s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>

        <CardContent className="flex-1 overflow-hidden p-0">
          <ScrollArea className="h-full">
            {conversations.map(c => (
              <button
                key={`${c.client_id}-${c.phone}`}
                onClick={() => selectConversation(c.phone, c.client_id)}
                className={cn(
                  'w-full border-b px-4 py-3 text-left transition-colors hover:bg-accent',
                  selectedPhone === c.phone && selectedClientId === c.client_id && 'bg-accent'
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{maskPhone(c.phone)}</span>
                  <Badge variant="outline" className="text-xs">{c.state}</Badge>
                </div>
                {auth?.role === 'owner' && (
                  <p className="mt-0.5 text-xs text-muted-foreground">{c.client_name}</p>
                )}
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {c.last_message || 'No messages'}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{timeAgo(c.updated_at)}</p>
              </button>
            ))}
            {conversations.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">No conversations found.</p>
            )}
          </ScrollArea>
        </CardContent>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t px-3 py-2">
            <Button
              variant="ghost"
              size="icon"
              disabled={page <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-xs text-muted-foreground">{page} / {totalPages}</span>
            <Button
              variant="ghost"
              size="icon"
              disabled={page >= totalPages}
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </Card>

      {/* Right: chat viewer */}
      <Card className="flex flex-1 flex-col">
        {detail ? (
          <>
            <CardHeader className="border-b pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">{maskPhone(detail.phone)}</CardTitle>
                  <p className="text-xs text-muted-foreground">{detail.client_name} &middot; {detail.state}</p>
                </div>
                <Badge variant="outline">{detail.messages?.length || 0} messages</Badge>
              </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden p-0">
              <ScrollArea className="h-[calc(100vh-18rem)] p-4">
                <div className="space-y-3">
                  {(detail.messages || []).map((msg: any, i: number) => (
                    <div
                      key={i}
                      className={cn(
                        'max-w-[75%] rounded-lg px-3 py-2 text-sm',
                        msg.role === 'user'
                          ? 'bg-muted'
                          : 'ml-auto bg-primary text-primary-foreground'
                      )}
                    >
                      {msg.content}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
            <div className="border-t p-3">
              <form
                onSubmit={e => { e.preventDefault(); handleSend(); }}
                className="flex gap-2"
              >
                <Input
                  value={messageText}
                  onChange={e => setMessageText(e.target.value)}
                  placeholder="Type a message..."
                  disabled={sending}
                />
                <Button type="submit" disabled={sending || !messageText.trim()}>
                  Send
                </Button>
              </form>
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            Select a conversation
          </div>
        )}
      </Card>
    </div>
  );
}
