import { useEffect, useState } from "react";
import { api } from "@/lib/api/client";
import { useAppStore } from "@/stores/appStore";

/** The signed-in property name for the V2 header context line. A plain read of the hotel record the user
 *  already belongs to (tenant-scoped by the server); never a paid call. Does nothing unless `enabled`, so the
 *  legacy Home makes no extra request. A failure just leaves the line out. */
export function useHotelName(enabled: boolean): string | null {
  const tenantId = useAppStore((s) => s.user?.tenant_id);
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !tenantId) {
      setName(null);
      return;
    }
    let mounted = true;
    api
      .get<{ data: { name?: string | null } }>(`/hotels/${tenantId}`)
      .then((res) => {
        if (mounted) setName(res.data?.name?.trim() || null);
      })
      .catch(() => {
        if (mounted) setName(null);
      });
    return () => {
      mounted = false;
    };
  }, [enabled, tenantId]);

  return name;
}
