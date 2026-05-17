import { apiClient } from '@/lib/api/client'

export interface OperaConnectRequest {
  ohip_base_url: string
  hotel_id_opera: string
  integration_username?: string
  integration_password?: string
}

export interface OperaConnectResponse {
  data: {
    connected: boolean
    message: string
  }
}

export interface OperaStatus {
  connected: boolean
  opera_hotel_id?: string
  ohip_base_url?: string
  last_sync_at?: string
  connected_since?: string
}

export interface OperaStatusResponse {
  data: OperaStatus
}

export interface OperaSyncResponse {
  data: {
    synced_reservations: number
    synced_at: string
  }
}

export interface OperaTestResponse {
  data: {
    connected: boolean
    message: string
  }
}

export const integrationsApi = {
  getOperaStatus: (): Promise<OperaStatusResponse> =>
    apiClient.get('/integrations/opera/status'),

  connectOpera: (body: OperaConnectRequest): Promise<OperaConnectResponse> =>
    apiClient.post('/integrations/opera/connect', body),

  syncOpera: (): Promise<OperaSyncResponse> =>
    apiClient.post('/integrations/opera/sync'),

  testOpera: (): Promise<OperaTestResponse> =>
    apiClient.post('/integrations/opera/test'),

  disconnectOpera: (): Promise<{ data: { connected: boolean; message: string } }> =>
    apiClient.delete('/integrations/opera/disconnect'),
}
