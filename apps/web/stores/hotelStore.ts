import { create } from 'zustand'

export interface Hotel {
  id: string
  name: string
  timezone: string
  room_count: number
  logo_url?: string
  front_desk_modules?: string[]
  web_redesign_sections?: string[]
  enabled_features?: string[]
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
  /** Provenance of the hotel record: which signed-in user and hotel the last successful GET /auth/me was for, and
   *  when (epoch ms). Consumers that depend on a per-hotel setting use it to ignore a record fetched for another user or hotel.
   *  Set only by setContext (never by setHotel, which also serves local edits and onboarding). */
  contextUserId: string | null
  contextHotelId: string | null
  contextFetchedAt: number | null
  setHotel: (hotel: Hotel) => void
  setHotels: (hotels: Hotel[]) => void
  setSubscription: (sub: Subscription) => void
  /** Store a freshly fetched /auth/me hotel context together with its provenance. */
  setContext: (ctx: { hotel: Hotel; hotels?: Hotel[]; userId: string | null; fetchedAt: number }) => void
  clear: () => void
}

export const useHotelStore = create<HotelStore>((set) => ({
  hotel: null,
  hotels: [],
  subscription: null,
  contextUserId: null,
  contextHotelId: null,
  contextFetchedAt: null,
  setHotel: (hotel) => set((state) => ({
    hotel,
    // A different hotel is not covered by the previous hotel's context read.
    ...(state.contextHotelId !== null && state.contextHotelId !== hotel.id
      ? { contextUserId: null, contextHotelId: null, contextFetchedAt: null }
      : {}),
    hotels: state.hotels.some((item) => item.id === hotel.id) ? state.hotels : [hotel, ...state.hotels],
  })),
  setHotels: (hotels) => set((state) => ({
    hotels,
    hotel: state.hotel ?? hotels[0] ?? null,
  })),
  setSubscription: (subscription) => set({ subscription }),
  setContext: ({ hotel, hotels, userId, fetchedAt }) =>
    set({
      hotel,
      hotels: hotels?.length ? hotels : [hotel],
      contextUserId: userId,
      contextHotelId: hotel.id,
      contextFetchedAt: fetchedAt,
    }),
  clear: () =>
    set({ hotel: null, hotels: [], subscription: null, contextUserId: null, contextHotelId: null, contextFetchedAt: null }),
}))
