import { useCallback, useMemo } from "react";
import { fetchDrafts, type Revision } from "@/lib/api/schedulingRevisions";
import { countDraft, type DraftCounts } from "@/lib/scheduling/draftOverlay";
import { useRemote } from "@/lib/scheduling/requestHooks";
import { useAppStore } from "@/stores/appStore";

/* The open drafts this supervisor may manage (one per department). Scoped to `tenant:user`: switching hotel or account
   drops the held answer. A failed refresh keeps the last good list marked `failed`; it is never shown as "no draft". */

export interface UseScheduleDrafts {
  drafts: Revision[];
  /** null while unknown (loading, or failed with nothing held). */
  counts: DraftCounts | null;
  status: "loading" | "ready" | "failed";
  reload: () => Promise<void>;
}

export function useScheduleDrafts(enabled: boolean): UseScheduleDrafts {
  const tenantId = useAppStore((state) => state.user?.tenant_id ?? null);
  const userId = useAppStore((state) => state.user?.id ?? null);
  const isOnline = useAppStore((state) => state.isOnline);
  const scope = tenantId && userId ? `${tenantId}:${userId}` : null;
  const remote = useRemote(fetchDrafts, [scope], enabled && isOnline && scope !== null);
  const drafts = useMemo(() => remote.data ?? [], [remote.data]);
  const counts = useMemo(() => (remote.data ? countDraft(remote.data) : null), [remote.data]);
  const refresh = remote.refresh;
  const reload = useCallback(() => refresh(), [refresh]);
  return { drafts, counts, status: remote.status, reload };
}
