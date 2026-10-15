import { useEffect, useState } from "react";
import { fetchMyWork } from "@/lib/api/tasks";
import { listItems } from "@/lib/api/lostFound";
import { localDate } from "@/lib/utils/date";
import type { ReviewExtras } from "@/lib/housekeeping/shiftReview";

const OPEN = new Set(["open", "in_progress", "escalated"]);

/**
 * Two real signals worth a last look before clocking out: tasks still assigned
 * to this person and lost & found items they logged today. Read-only and best
 * effort: if either cannot be read the line is simply left out (and clock-out is
 * never held up by it).
 */
export function useReviewExtras(active: boolean, isOnline: boolean, userId: string | undefined): ReviewExtras {
  const [extras, setExtras] = useState<ReviewExtras>({});

  useEffect(() => {
    if (!active || !isOnline || !userId) return;
    let cancelled = false;
    fetchMyWork()
      .then((result) => {
        if (!cancelled) setExtras((prev) => ({ ...prev, openTasks: result.tasks.filter((task) => OPEN.has(task.status)).length }));
      })
      .catch(() => undefined);
    listItems()
      .then((res) => {
        const today = localDate();
        const found = (res.data ?? []).filter((item) => item.found_by === userId && (item.created_at ?? "").slice(0, 10) === today);
        if (!cancelled) setExtras((prev) => ({ ...prev, foundToday: found.length }));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [active, isOnline, userId]);

  return extras;
}
