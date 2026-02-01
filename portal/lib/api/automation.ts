import { apiClient } from './client'

export interface AutomationStep {
  delayMinutes: number
  message: string
}

export interface AutomationSequence {
  id: string
  name: string
  steps: AutomationStep[]
  isActive: boolean
  createdAt: string
}

export interface AutomationEnrollment {
  id: string
  leadId: number
  sequenceId: string
  currentStep: number
  nextRunAt: string
  status: string
}

export const automationApi = {
  listSequences: async (clientId: string) => {
    const response = await apiClient.get(`/api/clients/${clientId}/automation/sequences`)
    return response.data.data.items as AutomationSequence[]
  },

  createSequence: async (clientId: string, payload: { name: string; steps: AutomationStep[] }) => {
    const response = await apiClient.post(`/api/clients/${clientId}/automation/sequences`, payload)
    return response.data.data
  },

  updateSequence: async (
    clientId: string,
    sequenceId: string,
    payload: Partial<{ name: string; steps: AutomationStep[]; isActive: boolean }>
  ) => {
    const response = await apiClient.put(
      `/api/clients/${clientId}/automation/sequences/${sequenceId}`,
      payload
    )
    return response.data.data
  },

  deleteSequence: async (clientId: string, sequenceId: string) => {
    const response = await apiClient.delete(`/api/clients/${clientId}/automation/sequences/${sequenceId}`)
    return response.data.data
  },

  enrollLead: async (clientId: string, leadId: number, sequenceId: string) => {
    const response = await apiClient.post(`/api/clients/${clientId}/automation/enroll`, {
      leadId,
      sequenceId
    })
    return response.data.data
  },

  listEnrollments: async (clientId: string) => {
    const response = await apiClient.get(`/api/clients/${clientId}/automation/enrollments`)
    return response.data.data.items as AutomationEnrollment[]
  },

  runNow: async (clientId: string) => {
    const response = await apiClient.post(`/api/clients/${clientId}/automation/run`)
    return response.data.data
  }
}
