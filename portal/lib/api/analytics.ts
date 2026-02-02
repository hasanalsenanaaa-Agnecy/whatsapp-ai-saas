import { apiClient } from './client'

export interface AnalyticsUploadRecord {
  id: string
  clientId: string
  filename: string
  mimeType: string
  sizeBytes: number
  status: string
  rowCount: number | null
  columns: string[]
  summary: Record<string, any>
  suggestions?: string[] | null
  dataType?: string | null
  notes?: string | null
  createdAt: string
}

export const analyticsApi = {
  uploadFile: async (
    clientId: string,
    file: File,
    dataType?: string,
    notes?: string
  ) => {
    const formData = new FormData()
    formData.append('file', file)
    if (dataType) formData.append('dataType', dataType)
    if (notes) formData.append('notes', notes)

    const response = await apiClient.post(
      `/api/clients/${clientId}/analytics/uploads`,
      formData
    )
    return response.data.data as { id: string; filename: string; mimeType: string; rowCount: number; columns: string[] }
  },

  listUploads: async (clientId: string) => {
    const response = await apiClient.get(`/api/clients/${clientId}/analytics/uploads`)
    return response.data.data as AnalyticsUploadRecord[]
  },

  getUpload: async (clientId: string, uploadId: string) => {
    const response = await apiClient.get(`/api/clients/${clientId}/analytics/uploads/${uploadId}`)
    return response.data.data as AnalyticsUploadRecord
  },

  getSuggestions: async (clientId: string, uploadId?: string) => {
    const response = await apiClient.post(`/api/clients/${clientId}/analytics/suggestions`, {
      uploadId
    })
    return response.data.data as { recommendations: string[] }
  }
}
