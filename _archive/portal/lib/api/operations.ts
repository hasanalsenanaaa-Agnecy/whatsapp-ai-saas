import { apiClient } from './client'

export interface APIKey {
  id: string
  clientId: string
  name: string
  createdAt: string
  lastUsedAt?: string
  isActive: boolean
}

export interface AuditLog {
  clientId?: string
  action: string
  resourceType?: string
  resourceId?: string
  changes?: Record<string, any>
  ipAddress?: string
  userAgent?: string
  status: 'success' | 'failed' | 'denied'
  errorMessage?: string
  createdAt: string
}

export const operationsApi = {
  listAPIKeys: async (clientId: string) => {
    const response = await apiClient.get(`/api/clients/${clientId}/api-keys`)
    return response.data.data
  },

  createAPIKey: async (clientId: string, name: string) => {
    const response = await apiClient.post(`/api/clients/${clientId}/api-keys`, { name })
    return response.data.data
  },

  revokeAPIKey: async (clientId: string, keyId: string) => {
    const response = await apiClient.delete(`/api/clients/${clientId}/api-keys/${keyId}`)
    return response.data.data
  },

  getAuditLogs: async (clientId: string, filters?: { action?: string; limit?: number }) => {
    const response = await apiClient.get(`/api/clients/${clientId}/audit-logs`, {
      params: filters
    })
    return response.data.data
  }
}
