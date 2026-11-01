/* ─── Work queue rows ───────────────────────────────────────────────────────
   Turns a view's loaded orders into the sections and cards the list shows. Pure; the screen adds banners and
   translates the section keys. A section's count is exact only when every page is loaded - while more pages
   remain it is a floor, and says so (`partial`) instead of passing a partial number off as a total. */

import {
  compareWorkOrders,
  groupMineWork,
  isClaimable,
  type MineGroupKey,
  type QueueSort,
  type QueueView,
} from "@/lib/engineering/workQueue";
import type { WorkOrder } from "@/lib/engineering/workOrders";

export type SectionKey = MineGroupKey | "claimable" | "needsOwner";

export type WorkRow =
  | { type: "section"; key: string; section: SectionKey; count: number; partial: boolean }
  | { type: "wo"; key: string; wo: WorkOrder };

interface Options {
  view: QueueView;
  role: string | null | undefined;
  sort: QueueSort;
  /** The server says more pages exist beyond the orders given. */
  hasMore: boolean;
}

export function buildWorkRows(orders: readonly WorkOrder[], { view, role, sort, hasMore }: Options): WorkRow[] {
  const rows: WorkRow[] = [];
  const section = (key: SectionKey, list: readonly WorkOrder[]) => {
    if (list.length === 0) return;
    rows.push({ type: "section", key: `s-${key}`, section: key, count: list.length, partial: hasMore });
    list.forEach((wo) => rows.push({ type: "wo", key: wo.id, wo }));
  };

  if (view === "mine") {
    for (const group of groupMineWork(orders, sort)) section(group.key, group.orders);
    return rows;
  }

  const ordered = [...orders].sort(compareWorkOrders(sort));
  if (view === "available") {
    const claimable = ordered.filter((wo) => isClaimable(wo, role));
    const needsOwner = ordered.filter((wo) => !isClaimable(wo, role));
    if (needsOwner.length === 0) {
      claimable.forEach((wo) => rows.push({ type: "wo", key: wo.id, wo }));
    } else {
      section("claimable", claimable);
      section("needsOwner", needsOwner);
    }
    return rows;
  }

  ordered.forEach((wo) => rows.push({ type: "wo", key: wo.id, wo }));
  return rows;
}
