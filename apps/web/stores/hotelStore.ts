import { create } from 'zustand'

interface Hotel {
  id: string
  name: string
  timezone: string
  room_count: number
  logo_url?: string
  front_desk_modules?: string[]
}

interface Subscription {
  plan_status: string
  credits_included: number
  cap_cents?: number
}

interface HotelStore {
  hotel: Hotel | null
  hotels: Hotel[]
  subscription: Subscription | null
  setHotel: (hotel: Hotel) => void
  setHotels: (hotels: Hotel[]) => void
  setSubscription: (sub: Subscription) => void
  clear: () => void
}

export const useHotelStore = create<HotelStore>((set) => ({
  hotel: null,
  hotels: [],
  subscription: null,
  setHotel: (hotel) => set((state) => ({
    hotel,
    hotels: state.hotels.some((item) => item.id === hotel.id) ? state.hotels : [hotel, ...state.hotels],
  })),
  setHotels: (hotels) => set((state) => ({
    hotels,
    hotel: state.hotel ?? hotels[0] ?? null,
  })),
  setSubscription: (subscription) => set({ subscription }),
  clear: () => set({ hotel: null, hotels: [], subscription: null }),
}))
