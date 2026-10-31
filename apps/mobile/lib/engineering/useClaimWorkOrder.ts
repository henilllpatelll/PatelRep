import { useCallback, useEffect, useRef, useState } from "react";
import { claimWorkOrder } from "@/lib/api/workOrders";
import { enqueueAction, getSyncQueueSummary } from "@/lib/offline/db";
import { classifyClaimError, isClaimable, workOrderLabel, type ClaimFailure } from "@/lib/engineering/workQueue";
import type { WorkOrder } from "@/lib/engineering/workOrders";

export type ClaimOutcome =
  | { kind: "confirmed"; wo: WorkOrder }
  /** Saved on this phone; the server has not accepted it. */
  | { kind: "queued"; wo: WorkOrder }
  | { kind: "failed"; wo: WorkOrder; failure: Exclude<ClaimFailure, "offline"> }
  | { kind: "ignored" };

interface Options {
  isOnline: boolean;
  role: string | null | undefined;
  /** Changes when the queue may have drained (reconnect, sync), so queued ids are re-read. */
  syncMarker?: string | null;
}

/**
 * Claiming a work order. The in-flight set is a ref as well as state so two quick taps cannot both reach the
 * API, and "queued" only ever means a claim row exists in the offline queue — never that the server agreed.
 */
export function useClaimWorkOrder({ isOnline, role, syncMarker }: Options) {
  const inFlight = useRef(new Set<string>());
  const [claimingIds, setClaimingIds] = useState<ReadonlySet<string>>(new Set());
  const [queuedIds, setQueuedIds] = useState<ReadonlySet<string>>(new Set());

  const refreshQueued = useCallback(async () => {
    try {
      const rows = await getSyncQueueSummary();
      setQueuedIds(new Set(rows.filter((r) => r.entity_type === "work_order" && r.action === "claim" && r.entity_id).map((r) => r.entity_id as string)));
    } catch {
      // Keep what we last knew; the claim buttons stay safe because the API re-checks every claim.
    }
  }, []);

  useEffect(() => {
    void refreshQueued();
  }, [refreshQueued, isOnline, syncMarker]);

  const setClaiming = (id: string, on: boolean) =>
    setClaimingIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const claim = useCallback(
    async (wo: WorkOrder): Promise<ClaimOutcome> => {
      // Eligibility is re-checked at the tap, not just when the button was drawn.
      if (!isClaimable(wo, role) || inFlight.current.has(wo.id) || queuedIds.has(wo.id)) return { kind: "ignored" };
      inFlight.current.add(wo.id);
      setClaiming(wo.id, true);

      const queue = async (): Promise<ClaimOutcome> => {
        const label = [workOrderLabel(wo), wo.title].filter(Boolean).join(" · ");
        await enqueueAction("work_order", "claim", { label }, wo.id);
        setQueuedIds((prev) => new Set(prev).add(wo.id));
        return { kind: "queued", wo };
      };

      try {
        if (!isOnline) return await queue();
        try {
          await claimWorkOrder(wo.id);
          return { kind: "confirmed", wo };
        } catch (error) {
          const failure = classifyClaimError(error);
          // The connection dropped under us: same as being offline, saved and clearly marked as not yet confirmed.
          if (failure === "offline") return await queue();
          return { kind: "failed", wo, failure };
        }
      } catch {
        return { kind: "failed", wo, failure: "failed" };
      } finally {
        inFlight.current.delete(wo.id);
        setClaiming(wo.id, false);
      }
    },
    [isOnline, role, queuedIds]
  );

  return { claim, claimingIds, queuedIds, refreshQueued };
}
