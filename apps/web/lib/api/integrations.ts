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
  /** 'api' (OHIP) or 'sftp_report' (scheduled report ingestion). Absent when not connected. */
  connection_mode?: string
  opera_hotel_id?: string
  ohip_base_url?: string
  sftp_host?: string | null
  sftp_remote_path?: string | null
  last_sync_at?: string | null
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

/** The only snapshot fields the UI reads; snapshots may carry more (e.g. guest email) that must not be shown. */
export interface OperaConflictSnapshot {
  guest_name?: string | null
  vip_flag?: boolean | null
  checkin_time?: string | null
  checkout_time?: string | null
}

export interface OperaSyncConflict {
  id: string
  entity_type: 'reservation' | 'room_status'
  external_id: string
  local_entity_id?: string | null
  local_snapshot: OperaConflictSnapshot | null
  remote_snapshot: OperaConflictSnapshot | null
  detected_at: string
}

export type OperaConflictResolution = 'local_wins' | 'remote_wins'

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

  listOperaConflicts: (): Promise<{ data: OperaSyncConflict[] }> =>
    apiClient.get('/integrations/opera/conflicts'),

  resolveOperaConflict: (id: string, resolution: OperaConflictResolution) =>
    apiClient.post(`/integrations/opera/conflicts/${id}/resolve`, { resolution }),

  testOpera: (): Promise<OperaTestResponse> =>
    apiClient.post('/integrations/opera/test'),

  syncOperaSftp: (): Promise<{ data: { files_processed: number; synced_rows: number; synced_at: string } }> =>
    apiClient.post('/integrations/opera/sftp/sync'),

  testOperaSftp: (): Promise<OperaTestResponse> =>
    apiClient.post('/integrations/opera/sftp/test'),

  disconnectOpera: (): Promise<{ data: { connected: boolean; message: string } }> =>
    apiClient.delete('/integrations/opera/disconnect'),
}
