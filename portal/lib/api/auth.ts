import { apiClient } from './client'

export interface LoginCredentials {
  clientId: string
  password?: string
}

export interface RegisterData {
  name: string
  industry: string
  agentPhones: string[]
}

export const authApi = {
  login: async (credentials: LoginCredentials) => {
    // Mock login - replace with actual API call when backend is ready
    const response = await apiClient.post('/auth/login', credentials)
    return response.data
  },

  register: async (data: RegisterData) => {
    const response = await apiClient.post('/auth/register', data)
    return response.data
  },

  refresh: async () => {
    const response = await apiClient.post('/auth/refresh')
    return response.data
  }
}
