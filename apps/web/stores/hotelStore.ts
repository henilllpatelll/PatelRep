import { create } from 'zustand'

interface Hotel {
  id: string
  name: string
  timezone: string
  room_count: number
  logo_url?: string
}

interface Subscription {
  plan_status: string
  credits_included: number
  cap_cents?: number
}

interface HotelStore {
  hotel: Hotel | null
  subscription: Subscription | null
  setHotel: (hotel: Hotel) => void
  setSubscription: (sub: Subscription) => void
  clear: () => void
}

export const useHotelStore = create<HotelStore>((set) => ({
  hotel: null,
  subscription: null,
  setHotel: (hotel) => set({ hotel }),
  setSubscription: (subscription) => set({ subscription }),
  clear: () => set({ hotel: null, subscription: null }),
}))
