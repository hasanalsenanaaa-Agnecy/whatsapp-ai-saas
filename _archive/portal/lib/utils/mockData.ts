import { Lead, DashboardStats } from '../api/leads'
import { APIKey, AuditLog } from '../api/operations'

export const mockLeads: Lead[] = [
  {
    id: 1,
    name: 'محمد العلي',
    phone: '0501234567',
    score: 'hot',
    status: 'new',
    data: {
      interest: 'جيب / SUV',
      budget: '100 - 150 ألف',
      notes: 'مهتم جداً، يريد زيارة المعرض'
    },
    createdAt: new Date().toISOString()
  },
  {
    id: 2,
    name: 'أحمد السعيد',
    phone: '0551234567',
    score: 'warm',
    status: 'contacted',
    data: {
      interest: 'سيدان',
      budget: '50 - 100 ألف',
      notes: 'تم التواصل، سيعاود الاتصال'
    },
    createdAt: new Date(Date.now() - 86400000).toISOString()
  },
  {
    id: 3,
    name: 'فاطمة الخالد',
    phone: '0561234567',
    score: 'hot',
    status: 'new',
    data: {
      interest: 'كومباكت',
      budget: 'أقل من 50 ألف',
      notes: 'تبحث عن سيارة اقتصادية'
    },
    createdAt: new Date(Date.now() - 172800000).toISOString()
  },
  {
    id: 4,
    name: 'عبدالله الحربي',
    phone: '0571234567',
    score: 'cold',
    status: 'contacted',
    data: {
      interest: 'شاحنة',
      budget: 'أكثر من 150 ألف',
      notes: 'يبحث فقط، لا استعجال'
    },
    createdAt: new Date(Date.now() - 259200000).toISOString()
  },
  {
    id: 5,
    name: 'سارة المنصور',
    phone: '0581234567',
    score: 'warm',
    status: 'converted',
    data: {
      interest: 'سيدان',
      budget: '100 - 150 ألف',
      notes: 'تم البيع - كامري 2024'
    },
    createdAt: new Date(Date.now() - 345600000).toISOString()
  }
]

export const mockStats: DashboardStats = {
  totalLeads: 47,
  todayLeads: 5,
  weekLeads: 23,
  hotLeads: 8,
  pendingAppointments: 3,
  conversionRate: 34
}

export const mockAPIKeys: APIKey[] = [
  {
    id: 'key_1',
    clientId: 'client_123',
    name: 'Production Key',
    createdAt: new Date(Date.now() - 2592000000).toISOString(),
    lastUsedAt: new Date(Date.now() - 3600000).toISOString(),
    isActive: true
  },
  {
    id: 'key_2',
    clientId: 'client_123',
    name: 'Development Key',
    createdAt: new Date(Date.now() - 1296000000).toISOString(),
    lastUsedAt: new Date(Date.now() - 86400000).toISOString(),
    isActive: true
  },
  {
    id: 'key_3',
    clientId: 'client_123',
    name: 'Old Key (Revoked)',
    createdAt: new Date(Date.now() - 7776000000).toISOString(),
    lastUsedAt: new Date(Date.now() - 5184000000).toISOString(),
    isActive: false
  }
]

export const mockAuditLogs: AuditLog[] = [
  {
    clientId: 'client_123',
    action: 'lead_created',
    resourceType: 'lead',
    resourceId: '1',
    status: 'success',
    ipAddress: '192.168.1.1',
    userAgent: 'Mozilla/5.0',
    createdAt: new Date().toISOString()
  },
  {
    clientId: 'client_123',
    action: 'api_key_created',
    resourceType: 'api_key',
    resourceId: 'key_2',
    status: 'success',
    ipAddress: '192.168.1.1',
    userAgent: 'Mozilla/5.0',
    createdAt: new Date(Date.now() - 3600000).toISOString()
  },
  {
    clientId: 'client_123',
    action: 'lead_updated',
    resourceType: 'lead',
    resourceId: '5',
    changes: { status: 'converted' },
    status: 'success',
    ipAddress: '192.168.1.1',
    userAgent: 'Mozilla/5.0',
    createdAt: new Date(Date.now() - 7200000).toISOString()
  },
  {
    clientId: 'client_123',
    action: 'login',
    status: 'success',
    ipAddress: '192.168.1.1',
    userAgent: 'Mozilla/5.0',
    createdAt: new Date(Date.now() - 10800000).toISOString()
  }
]

// Mock API functions that use mock data
export const useMockData = process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true'

export function getMockLeads(filters?: any): Lead[] {
  let filtered = [...mockLeads]
  
  if (filters?.status) {
    filtered = filtered.filter(l => l.status === filters.status)
  }
  if (filters?.score) {
    filtered = filtered.filter(l => l.score === filters.score)
  }
  if (filters?.search) {
    const search = filters.search.toLowerCase()
    filtered = filtered.filter(l =>
      l.name.toLowerCase().includes(search) ||
      l.phone.includes(search)
    )
  }
  
  return filtered
}
