import { useCallback, useEffect, useRef, useState } from "react";
import { fetchShiftDetail, type ShiftDetail } from "@/lib/api/schedulingManage";

/* One shift's detail (server-verified attendance timeline + room summary). Re-reads when the shift or its version
   changes, so an edit shows up without closing the sheet. A failure leaves `detail` null: the sheet then shows only
   what the schedule already knew and says the rest could not be loaded. */

export type DetailState = { status: "loading" } | { status: "ready"; detail: ShiftDetail } | { status: "failed" };

export function useShiftDetail(shiftId: string | null, version: number | null, enabled: boolean) {
  const [state, setState] = useState<DetailState>({ status: "loading" });
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!shiftId) return;
    const mine = ++seq.current;
    try {
      const detail = await fetchShiftDetail(shiftId);
      if (mine === seq.current) setState({ status: "ready", detail });
    } catch {
      if (mine === seq.current) setState((held) => (held.status === "ready" ? held : { status: "failed" }));
    }
  }, [shiftId]);

  useEffect(() => {
    if (!enabled || !shiftId) return;
    setState({ status: "loading" });
    void load();
  }, [enabled, shiftId, version, load]);

  useEffect(
    () => () => {
      seq.current += 1;
    },
    [],
  );

  return { state, reload: load };
}
