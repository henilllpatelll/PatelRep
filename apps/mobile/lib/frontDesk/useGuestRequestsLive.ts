import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAppStore } from "@/stores/appStore";
import { fetchGuestRequests } from "@/lib/frontDesk/guestRequestsApi";
import type { GuestRequestView } from "@/lib/frontDesk/guestRequests";

/** The guest request list with the same realtime subscription the legacy screen used (hotel-scoped
 *  `guest_requests` changes trigger a reload). A failed reload keeps the last good rows and flags them stale: it never
 *  turns into an empty list. A late answer from an older request cannot overwrite a newer one. */
export function useGuestRequestsLive() {
  const isOnline = useAppStore((s) => s.isOnline);
  const tenantId = useAppStore((s) => s.user?.tenant_id);
  const [rows, setRows] = useState<GuestRequestView[] | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [stale, setStale] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const seq = useRef(0);
  const hasData = useRef(false);

  const load = useCallback(async () => {
    if (!isOnline) {
      setStatus((s) => (s === "loading" ? "ready" : s));
      return;
    }
    const mine = ++seq.current;
    try {
      const data = await fetchGuestRequests();
      if (mine !== seq.current) return;
      hasData.current = true;
      setRows(data);
      setStatus("ready");
      setStale(false);
      setFetchedAt(Date.now());
    } catch {
      if (mine !== seq.current) return;
      if (hasData.current) setStale(true);
      else setStatus("error");
    }
  }, [isOnline]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!tenantId) return undefined;
    const channel = supabase
      .channel("guest_requests_mobile_v2")
      .on("postgres_changes", { event: "*", schema: "public", table: "guest_requests", filter: `tenant_id=eq.${tenantId}` }, () => {
        void load();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [tenantId, load]);

  return { rows, status, stale, fetchedAt, isOnline, refresh: load };
}
