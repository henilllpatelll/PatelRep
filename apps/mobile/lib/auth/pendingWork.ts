import { useMemo } from "react";
import { entriesForCurrentUser, useTaskOutbox } from "@/lib/tasks/offline/taskOutbox";
import { taskScope } from "@/lib/tasks/offline/taskCache";
import { useAppStore, type OfflineAction } from "@/stores/appStore";
import { useCleanSessionStore } from "@/stores/cleanSessionStore";
import type { LocalCleanSession } from "@/lib/housekeeping/cleanSession";

export type PendingCategoryKey = "roomUpdates" | "taskCompletions" | "workOrders" | "logbook" | "cleaningSessions";

export interface PendingCategory {
  key: PendingCategoryKey;
  count: number;
  /** Oldest queued time among these changes, when the queue records one. */
  oldestAt: string | null;
  /** How many of them were refused or conflict and need the person's attention. */
  needsAttention: number;
}

const ACTION_CATEGORY: Record<OfflineAction["type"], PendingCategoryKey> = {
  room_status: "roomUpdates",
  task_complete: "taskCompletions",
  work_order_update: "workOrders",
  logbook_create: "logbook",
};

function sessionIsUnsynced(s: LocalCleanSession): boolean {
  return (
    !s.startConfirmed ||
    (!!s.completeRequestedAt && !s.completionConfirmed) ||
    Object.keys(s.pendingItems ?? {}).length > 0 ||
    !!s.completionUnsure
  );
}

const older = (a: string | null, b: string | null) => (a && b ? (a < b ? a : b) : (a ?? b));

/**
 * Work saved on this phone that the server has not confirmed, for the signed-in person only, grouped by
 * kind. Built from the real queues (legacy action queue, task outbox, clean sessions); nothing is
 * invented, and other people's saved work is never counted because each store only holds the current
 * person's scope in memory.
 */
export function summarizePendingWork(input: {
  userScope: string | null;
  actions: OfflineAction[];
  outboxScope: string | null;
  outbox: ReturnType<typeof entriesForCurrentUser>;
  sessionScope: string | null;
  sessions: Record<string, LocalCleanSession>;
}): PendingCategory[] {
  const byKey = new Map<PendingCategoryKey, PendingCategory>();
  const add = (key: PendingCategoryKey, at: string | null, attention: boolean) => {
    const row = byKey.get(key) ?? { key, count: 0, oldestAt: null, needsAttention: 0 };
    row.count += 1;
    row.oldestAt = older(row.oldestAt, at);
    if (attention) row.needsAttention += 1;
    byKey.set(key, row);
  };

  for (const action of input.actions) {
    // An action stamped with another owner is never this person's to see.
    if (action.owner && input.userScope && action.owner !== input.userScope) continue;
    add(ACTION_CATEGORY[action.type] ?? "roomUpdates", action.createdAt ?? null, false);
  }
  if (input.userScope && input.outboxScope === input.userScope) {
    for (const entry of Object.values(input.outbox)) {
      add("taskCompletions", entry.queuedAt ?? null, entry.state !== "pending");
    }
  }
  if (input.userScope && input.sessionScope === input.userScope) {
    for (const session of Object.values(input.sessions)) {
      if (sessionIsUnsynced(session)) add("cleaningSessions", session.completeRequestedAt ?? session.startedAt ?? null, !!session.conflict || !!session.lastError);
    }
  }
  return [...byKey.values()];
}

export const totalPending = (rows: PendingCategory[]) => rows.reduce((sum, r) => sum + r.count, 0);

/** Reactive version for UI. */
export function useUnsyncedSummary(): PendingCategory[] {
  const user = useAppStore((s) => s.user);
  const actions = useAppStore((s) => s.pendingActions);
  const outboxScope = useTaskOutbox((s) => s.scope);
  const outboxEntries = useTaskOutbox((s) => s.entries);
  const sessionScope = useCleanSessionStore((s) => s.scope);
  const sessions = useCleanSessionStore((s) => s.sessions);
  return useMemo(
    () =>
      summarizePendingWork({
        userScope: taskScope(user),
        actions,
        outboxScope,
        outbox: entriesForCurrentUser({ scope: outboxScope, entries: outboxEntries }),
        sessionScope,
        sessions,
      }),
    [user, actions, outboxScope, outboxEntries, sessionScope, sessions],
  );
}
