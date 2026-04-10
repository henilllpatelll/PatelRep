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

export interface UpdateHotelData extends Partial<CreateHotelData> {
  front_desk_modules?: string[]
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
      front_desk_modules?: string[]
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
    hotel_id: string
    room_count: number
    active_staff: number
    open_tasks: number
    open_work_orders: number
  }
}

export const hotelsApi = {
  create: (data: CreateHotelData): Promise<HotelResponse> =>
    apiClient.post('/hotels', data),

  get: (hotelId: string): Promise<{ data: HotelResponse['data']['hotel'] }> =>
    apiClient.get(`/hotels/${hotelId}`),

  update: (hotelId: string, data: UpdateHotelData): Promise<{ data: HotelResponse['data']['hotel'] }> =>
    apiClient.patch(`/hotels/${hotelId}`, data),

  getStats: (hotelId: string): Promise<HotelStatsResponse> =>
    apiClient.get(`/hotels/${hotelId}/stats`),
}
