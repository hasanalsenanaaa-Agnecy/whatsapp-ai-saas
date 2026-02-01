import { apiClient } from './client'

export interface Lead {
  id: number
  name: string
  phone: string
  score: 'hot' | 'warm' | 'cold'
  status: 'new' | 'contacted' | 'converted' | 'lost'
  data: Record<string, any>
  createdAt: string
}

export interface LeadsFilters {
  status?: string
  score?: string
  search?: string
  page?: number
  limit?: number
}

export interface DashboardStats {
  totalLeads: number
  todayLeads: number
  weekLeads: number
  hotLeads: number
  pendingAppointments: number
  conversionRate: number
}

export interface LeadAnalytics {
  totalLeads: number
  conversionRate: number
  pendingAppointments: number
  statusBreakdown: Record<string, number>
  scoreBreakdown: Record<string, number>
}

export const leadsApi = {
  getLeads: async (clientId: string, filters?: LeadsFilters) => {
    const response = await apiClient.get(`/api/clients/${clientId}/leads`, {
      params: filters
    })
    return {
      items: response.data.data,
      pagination: response.data.pagination
    }
  },

  getLead: async (clientId: string, leadId: number) => {
    const response = await apiClient.get(`/api/clients/${clientId}/leads/${leadId}`)
    return response.data.data
  },

  createLead: async (clientId: string, lead: Partial<Lead>) => {
    const response = await apiClient.post(`/api/clients/${clientId}/leads`, lead)
    return response.data.data
  },

  updateLead: async (clientId: string, leadId: number, lead: Partial<Lead>) => {
    const response = await apiClient.put(`/api/clients/${clientId}/leads/${leadId}`, lead)
    return response.data.data
  },

  deleteLead: async (clientId: string, leadId: number) => {
    const response = await apiClient.delete(`/api/clients/${clientId}/leads/${leadId}`)
    return response.data.data
  },

  getDashboardStats: async (clientId: string) => {
    const response = await apiClient.get(`/api/clients/${clientId}/dashboard`)
    return response.data.data
  },

  getAnalytics: async (clientId: string) => {
    const response = await apiClient.get(`/api/clients/${clientId}/analytics`)
    return response.data.data as LeadAnalytics
  }
}
