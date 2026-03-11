import { apiClient } from '@/lib/api/client'

export interface CreateHotelData {
  name: string
  address: string
  city: string
  state: string
  zip: string
  phone: string
  room_count: number
  timezone: string
}

export interface HotelResponse {
  data: {
    hotel: {
      id: string
      name: string
      address: string
      city: string
      state: string
      zip: string
      phone: string
      room_count: number
      timezone: string
      logo_url?: string
      created_at: string
    }
    subscription: {
      plan_status: string
      credits_included: number
      cap_cents?: number
    }
  }
}

export interface HotelStatsResponse {
  data: {
    total_rooms: number
    occupied_rooms: number
    clean_rooms: number
    dirty_rooms: number
    maintenance_rooms: number
    open_tasks: number
    staff_count: number
  }
}

export const hotelsApi = {
  create: (data: CreateHotelData): Promise<HotelResponse> =>
    apiClient.post('/hotels', data),

  get: (hotelId: string): Promise<{ data: HotelResponse['data']['hotel'] }> =>
    apiClient.get(`/hotels/${hotelId}`),

  update: (hotelId: string, data: Partial<CreateHotelData>): Promise<{ data: HotelResponse['data']['hotel'] }> =>
    apiClient.patch(`/hotels/${hotelId}`, data),

  getStats: (hotelId: string): Promise<HotelStatsResponse> =>
    apiClient.get(`/hotels/${hotelId}/stats`),
}
