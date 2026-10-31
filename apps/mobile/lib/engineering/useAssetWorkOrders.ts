import { useCallback, useEffect, useState } from "react";
import { listAssetWorkOrderPage } from "@/lib/api/workOrders";
import { dedupeById } from "@/lib/engineering/workQueue";
import type { WorkOrder } from "@/lib/engineering/workOrders";
import { useAsyncResource, type AsyncResource } from "@/lib/engineering/useAsyncResource";
import type { WorkOrderPage } from "@/lib/api/workOrders";

export interface AssetWorkOrders {
  orders: WorkOrder[];
  hasMore: boolean;
  loadingMore: boolean;
  /** Paging past the first page failed; the rows already shown stay. */
  moreFailed: boolean;
  resource: AsyncResource<WorkOrderPage>;
  loadMore: () => void;
  reload: () => Promise<void>;
}

/**
 * The work orders linked to one asset, active or completed, a page at a time. The first page rides the shared
 * resource guards (stale answers dropped, last good rows kept on failure); further pages are merged by id.
 */
export function useAssetWorkOrders(scope: string | null, assetId: string, kind: "active" | "completed", enabled = true): AssetWorkOrders {
  const resource = useAsyncResource((signal) => listAssetWorkOrderPage(assetId, kind, 1, signal), {
    scope,
    key: `asset-wo:${assetId}:${kind}`,
    enabled,
  });
  const [more, setMore] = useState<{ orders: WorkOrder[]; page: number; hasMore: boolean } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);

  // A fresh first page (new asset, refresh, scope change) discards the pages stacked on the old one.
  useEffect(() => {
    setMore(null);
    setMoreFailed(false);
  }, [scope, assetId, kind, resource.syncedAt]);

  const loadMore = useCallback(() => {
    const first = resource.data;
    if (!first || loadingMore || !(more ? more.hasMore : first.hasMore)) return;
    const page = (more?.page ?? 1) + 1;
    setLoadingMore(true);
    setMoreFailed(false);
    listAssetWorkOrderPage(assetId, kind, page)
      .then((next) => setMore((prev) => ({ orders: dedupeById([...(prev?.orders ?? []), ...next.orders]), page, hasMore: next.hasMore })))
      .catch(() => setMoreFailed(true))
      .finally(() => setLoadingMore(false));
  }, [resource.data, more, loadingMore, assetId, kind]);

  const orders = dedupeById([...(resource.data?.orders ?? []), ...(more?.orders ?? [])]);
  return {
    orders,
    hasMore: more ? more.hasMore : resource.data?.hasMore ?? false,
    loadingMore,
    moreFailed,
    resource,
    loadMore,
    reload: resource.reload,
  };
}
