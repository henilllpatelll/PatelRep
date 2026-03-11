import { apiClient } from '@/lib/api/client'

export interface OperaStatus {
  connected: boolean
  opera_hotel_id?: string
  ohip_base_url?: string
  last_sync_at?: string
  connected_since?: string
}

export interface OperaConnectResponse {
  data: {
    auth_url: string
    hotel_id: string
  }
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

  connectOpera: (): Promise<OperaConnectResponse> =>
    apiClient.post('/integrations/opera/connect'),

  syncOpera: (): Promise<OperaSyncResponse> =>
    apiClient.post('/integrations/opera/sync'),

  testOpera: (): Promise<OperaTestResponse> =>
    apiClient.post('/integrations/opera/test'),

  disconnectOpera: (): Promise<{ data: { connected: boolean; message: string } }> =>
    apiClient.delete('/integrations/opera/disconnect'),
}
