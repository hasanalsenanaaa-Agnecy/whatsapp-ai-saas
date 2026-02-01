import { apiClient } from './client'

export interface KnowledgeItem {
  category: string
  question: string
  answer: string
}

export interface AIChatResponse {
  answer: string
  confident: boolean
  suggestHandover: boolean
}

export const aiApi = {
  getKnowledgeBase: async (clientId: string) => {
    const response = await apiClient.get(`/api/clients/${clientId}/knowledge`)
    return response.data.data.knowledgeBase as KnowledgeItem[]
  },

  updateKnowledgeBase: async (clientId: string, knowledgeBase: KnowledgeItem[]) => {
    const response = await apiClient.put(`/api/clients/${clientId}/knowledge`, {
      knowledgeBase
    })
    return response.data.data
  },

  chat: async (
    clientId: string,
    message: string,
    customerContext?: Record<string, any>
  ) => {
    const response = await apiClient.post(`/api/clients/${clientId}/ai/chat`, {
      message,
      customerContext,
      conversationHistory: []
    })
    return response.data.data as AIChatResponse
  },

  scoreLead: async (clientId: string, leadData: Record<string, any>) => {
    const response = await apiClient.post(`/api/clients/${clientId}/ai/score-lead`, {
      leadData
    })
    return response.data.data as { score: 'hot' | 'warm' | 'cold'; rationale: string }
  },

  submitFeedback: async (
    clientId: string,
    feedback: { aiResponse: string; rating: number; comment?: string }
  ) => {
    const response = await apiClient.post(`/api/clients/${clientId}/ai/feedback`, feedback)
    return response.data.data
  }
}
