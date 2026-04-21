const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

async function apiFetch<T>(path: string, key: string, opts?: RequestInit): Promise<T> {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${API_URL}${path}${sep}key=${encodeURIComponent(key)}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `API error ${res.status}`);
  }
  return res.json();
}

// Auth
export function validateKey(key: string) {
  return apiFetch<{ role: 'owner' | 'client'; clientId?: string; clientName?: string }>(
    '/api/auth/validate', key
  );
}

// Analytics
export function getRevenue(key: string, clientId?: string, months = 3) {
  const params = clientId ? `?client_id=${clientId}&months=${months}` : `?months=${months}`;
  return apiFetch<any[]>(`/api/analytics/revenue${params}`, key);
}

export function getFunnel(key: string, clientId: string, months = 3) {
  return apiFetch<any[]>(`/api/analytics/funnel?client_id=${clientId}&months=${months}`, key);
}

export function getUsage(key: string, clientId?: string, months = 3) {
  const params = clientId ? `?client_id=${clientId}&months=${months}` : `?months=${months}`;
  return apiFetch<any[]>(`/api/analytics/usage${params}`, key);
}

export function getProducts(key: string, clientId: string, months = 3) {
  return apiFetch<any[]>(`/api/analytics/products?client_id=${clientId}&months=${months}`, key);
}

export function getAICost(key: string, clientId?: string, months = 3) {
  const params = clientId ? `?client_id=${clientId}&months=${months}` : `?months=${months}`;
  return apiFetch<any[]>(`/api/analytics/ai-cost${params}`, key);
}

// Conversations
export function getConversations(key: string, opts?: { clientId?: string; state?: string; page?: number }) {
  const params = new URLSearchParams();
  if (opts?.clientId) params.set('client_id', opts.clientId);
  if (opts?.state) params.set('state', opts.state);
  if (opts?.page) params.set('page', String(opts.page));
  const qs = params.toString();
  return apiFetch<{ conversations: any[]; total: number }>(
    `/api/conversations${qs ? '?' + qs : ''}`, key
  );
}

export function getConversationDetail(key: string, phone: string, clientId: string) {
  return apiFetch<any>(`/api/conversations/${encodeURIComponent(phone)}?client_id=${clientId}`, key);
}

export function sendMessage(key: string, phone: string, clientId: string, message: string) {
  return apiFetch<{ success: boolean }>(
    `/api/conversations/${encodeURIComponent(phone)}/send?client_id=${clientId}`, key,
    { method: 'POST', body: JSON.stringify({ message }) }
  );
}

// Clients (owner only)
export function getClients(key: string) {
  return apiFetch<any[]>('/api/clients', key);
}

// Alerts
export function getAlerts(key: string, clientId?: string, limit = 50) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (clientId) params.set('client_id', clientId);
  return apiFetch<any[]>(`/api/alerts?${params}`, key);
}

// Health
export function getHealth() {
  return fetch(`${API_URL}/health`).then(r => r.json());
}
