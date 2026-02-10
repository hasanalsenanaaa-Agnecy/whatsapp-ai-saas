import { apiClient } from './client'

export interface LoginCredentials {
  clientId: string
  apiKey: string
}

export interface PasswordLoginCredentials {
  email: string
  password: string
}

export interface RegisterData {
  name: string
  industry: string
  agentPhones: string[]
}

export const authApi = {
  login: async (credentials: LoginCredentials) => {
    const response = await apiClient.post('/auth/login', credentials)
    return response.data
  },

  loginWithPassword: async (credentials: PasswordLoginCredentials) => {
    const response = await apiClient.post('/auth/login/password', credentials)
    return response.data
  },

  requestPasswordReset: async (email: string) => {
    const response = await apiClient.post('/auth/password-reset/request', { email })
    return response.data
  },

  confirmPasswordReset: async (token: string, newPassword: string) => {
    const response = await apiClient.post('/auth/password-reset/confirm', { token, newPassword })
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
