import { useEffect } from "react";
import { api } from "@/lib/api/client";
import { useAppStore } from "@/stores/appStore";
import { isValidTimeZone } from "./hotelTime";

interface MeResponse {
  hotel?: { id?: string | null; timezone?: string | null } | null;
}

/**
 * Supervisors never open the housekeeper My Rooms flow, which is what normally teaches the app the hotel's zone,
 * so without this their "today" is computed in the default zone and is wrong for a hotel anywhere else.
 * Reads the authenticated hotel's configured zone once (GET /auth/me) when the store has none. Only that hotel's own
 * answer is accepted, and nothing is written if the person or hotel changed while the request was in flight.
 * A failed read leaves the established default in place; the next mount tries again.
 */
export function useHotelTimezone(): void {
  const tenantId = useAppStore((state) => state.user?.tenant_id ?? null);
  const hasZone = useAppStore((state) => isValidTimeZone(state.hotelTimezone));
  const isOnline = useAppStore((state) => state.isOnline);

  useEffect(() => {
    if (!tenantId || hasZone || !isOnline) return;
    let cancelled = false;
    void api
      .get<MeResponse>("/auth/me")
      .then((res) => {
        const hotel = res?.hotel;
        if (cancelled || !hotel || hotel.id !== tenantId || !isValidTimeZone(hotel.timezone)) return;
        const state = useAppStore.getState();
        if (state.user?.tenant_id !== tenantId || isValidTimeZone(state.hotelTimezone)) return;
        state.setHotelTimezone(hotel.timezone);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [tenantId, hasZone, isOnline]);
}
