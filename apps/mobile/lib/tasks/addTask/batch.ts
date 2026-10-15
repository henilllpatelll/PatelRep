import { useCallback, useRef, useState } from "react";
import type { RoomOption, Task } from "@/lib/api/tasks";
import { newRequestId, toCreateInput, validateDraft, type TaskDraft } from "@/lib/tasks/addTask/draft";
import { submitCreateTask, taskDestination, type SubmitOutcome, type TaskDestination } from "@/lib/tasks/addTask/submit";

/* ─── Several suggested tasks, reviewed together, created one by one ────────
   A description can hold more than one task ("Room 405 needs two towels, and the third-floor cart needs
   more shampoo"). Each suggestion becomes its own item with its OWN idempotency key and its own state, and
   is created through the same POST /tasks the single-task flow uses -- so every task keeps the normal task
   rules, and "2 tasks created" is only ever said after two server-stored rows came back.

   Creation is sequential and stops at the first answer that makes sending more pointless (signed out,
   offline, no answer): what was already created stays created and is never sent again; the rest are left
   for a retry that sends only the failed or unsent ones. Nothing here edits a task after it exists. */

export type BatchProblem = "invalid" | "rejected" | "forbidden" | "signedOut" | "unconfirmed" | "offline";

/**
 * ready    in the list, not sent yet (or sent and refused, then edited: it can go again)
 * creating a request is in flight
 * created  the server stored it (`task` is its row); final
 * failed   the last attempt did not create it (`problem` says why)
 */
export type BatchStatus = "ready" | "creating" | "created" | "failed";

export interface BatchItem {
  /** Stable local identity for the list (not the idempotency key). */
  key: string;
  draft: TaskDraft;
  include: boolean;
  status: BatchStatus;
  task: Task | null;
  replayed: boolean;
  destination: TaskDestination | null;
  problem: BatchProblem | null;
  /** The server's own words for a refused task, when it gave any. */
  message: string | null;
}

let counter = 0;
function nextKey(): string {
  counter += 1;
  return `suggestion-${Date.now().toString(36)}-${counter}`;
}

/** One item per suggestion. Each gets its own request id: the parser hands every draft the same one. */
export function batchFromDrafts(drafts: TaskDraft[]): BatchItem[] {
  return drafts.map((draft) => ({
    key: nextKey(),
    draft: { ...draft, requestId: newRequestId(), extraTasks: 0 },
    include: true,
    status: "ready",
    task: null,
    replayed: false,
    destination: null,
    problem: null,
    message: null,
  }));
}

/** Replace one item's draft with the person's edit. A created task is final and never edited here. */
export function withEditedDraft(items: BatchItem[], key: string, draft: TaskDraft): BatchItem[] {
  return items.map((item) => {
    if (item.key !== key || item.status === "created" || item.status === "creating") return item;
    const refused = item.problem === "rejected" || item.problem === "forbidden" || item.problem === "invalid";
    return {
      ...item,
      // The server answered "no" to the previous details, so nothing exists under that key: a corrected
      // item gets a fresh one. An unconfirmed item keeps its key so a retry cannot double-create.
      draft: refused ? { ...draft, requestId: newRequestId() } : draft,
      status: item.status === "failed" ? "ready" : item.status,
      problem: refused ? null : item.problem,
      message: refused ? null : item.message,
    };
  });
}

export function withIncluded(items: BatchItem[], key: string, include: boolean): BatchItem[] {
  // A task that already exists cannot be taken out of the batch; it is shown as created.
  return items.map((item) => (item.key === key && item.status !== "created" && item.status !== "creating" ? { ...item, include } : item));
}

/**
 * Check every suggested room against the hotel's own room directory. A room the AI/server linked that is not in
 * the directory (or whose number does not match the id) is shown as unverified and must be corrected: a task is
 * never attached to a room this hotel's list does not contain. Returns the SAME array when nothing changed.
 */
export function reverifyRooms(items: BatchItem[], rooms: RoomOption[]): BatchItem[] {
  if (rooms.length === 0) return items;
  const byId = new Map(rooms.map((room) => [room.id, room]));
  let changed = false;
  const next = items.map((item) => {
    const { location } = item.draft;
    if (item.status === "created" || location.kind !== "room") return item;
    const known = byId.get(location.roomId);
    if (known && known.room_number === location.roomNumber) return item;
    changed = true;
    return { ...item, draft: { ...item.draft, location: { kind: "unverified" as const, text: location.roomNumber } } };
  });
  return changed ? next : items;
}

/** Items still to be created: included, and not already on the server. */
export function pendingItems(items: BatchItem[]): BatchItem[] {
  return items.filter((item) => item.include && item.status !== "created");
}

export interface BatchReadiness {
  /** Nothing pending is incomplete or unverified, and there is something to create. */
  ready: boolean;
  /** How many tasks the button would create. */
  count: number;
  /** Included items whose details still need fixing. */
  invalidKeys: string[];
}

export function batchReadiness(items: BatchItem[], zone: string | null | undefined, now: Date = new Date()): BatchReadiness {
  const pending = pendingItems(items);
  const invalidKeys = pending.filter((item) => !validateDraft(item.draft, zone, now).valid).map((item) => item.key);
  return { ready: pending.length > 0 && invalidKeys.length === 0, count: pending.length, invalidKeys };
}

export interface BatchSummary {
  /** Items the person is keeping in the batch. */
  included: number;
  created: number;
  failed: number;
  /** Included, never attempted (the batch stopped before reaching them). */
  unsent: number;
}

export function summarizeBatch(items: BatchItem[]): BatchSummary {
  const kept = items.filter((item) => item.include || item.status === "created");
  return {
    included: kept.length,
    created: kept.filter((item) => item.status === "created").length,
    failed: kept.filter((item) => item.status === "failed").length,
    unsent: kept.filter((item) => item.status === "ready" || item.status === "creating").length,
  };
}

export interface CreatedTaskInfo {
  task: Task;
  replayed: boolean;
  destination: TaskDestination;
}

/** Every task the server confirmed, in list order. */
export function createdTasks(items: BatchItem[]): CreatedTaskInfo[] {
  return items.flatMap((item) =>
    item.status === "created" && item.task ? [{ task: item.task, replayed: item.replayed, destination: item.destination ?? "team" }] : [],
  );
}

export type BatchHalt = "signedOut" | "offline" | "unconfirmed";

export interface BatchContext {
  zone: string | null | undefined;
  viewer: { id: string | null; role: string | null };
  isOnline: boolean;
  /** Called after each item changes, so the list shows progress. */
  onUpdate?: (items: BatchItem[]) => void;
  /** Injected for tests. */
  submit?: (input: NonNullable<ReturnType<typeof toCreateInput>>, isOnline: boolean) => Promise<SubmitOutcome>;
  now?: () => Date;
}

export interface BatchResult {
  items: BatchItem[];
  /** Why sending stopped early, when it did. The items it never reached stay `ready`. */
  halted: BatchHalt | null;
}

function update(items: BatchItem[], key: string, change: Partial<BatchItem>): BatchItem[] {
  return items.map((item) => (item.key === key ? { ...item, ...change } : item));
}

/**
 * Create every pending item, one at a time. Already-created items are skipped (so a retry never sends them
 * again). Returns the new item list; the caller reports only what `createdTasks` says exists.
 */
export async function submitBatch(start: BatchItem[], context: BatchContext): Promise<BatchResult> {
  const submit = context.submit ?? submitCreateTask;
  const clock = context.now ?? (() => new Date());
  let items = start;
  let halted: BatchHalt | null = null;
  const publish = (next: BatchItem[]) => {
    items = next;
    context.onUpdate?.(items);
  };

  for (const queued of pendingItems(start)) {
    if (halted) break;
    // Re-read: an earlier iteration only touches its own item, but the draft is what gets validated.
    const current = items.find((item) => item.key === queued.key);
    if (!current || !current.include || current.status === "created") continue;

    // The details are checked again right before sending: a due time may have passed while the list was open.
    const validation = validateDraft(current.draft, context.zone, clock());
    const input = toCreateInput(current.draft, validation, context.viewer.id);
    if (!input) {
      publish(update(items, current.key, { status: "failed", problem: "invalid", message: null }));
      continue;
    }

    publish(update(items, current.key, { status: "creating", problem: null, message: null }));
    const outcome = await submit(input, context.isOnline);

    switch (outcome.kind) {
      case "created":
        publish(
          update(items, current.key, {
            status: "created",
            task: outcome.task,
            replayed: outcome.replayed,
            destination: taskDestination(outcome.task, context.viewer),
            problem: null,
            message: null,
          }),
        );
        break;
      case "rejected":
        publish(
          update(items, current.key, {
            status: "failed",
            problem: "rejected",
            message: outcome.message,
            draft: { ...current.draft, requestId: newRequestId() },
          }),
        );
        break;
      case "forbidden":
        publish(update(items, current.key, { status: "failed", problem: "forbidden", message: null, draft: { ...current.draft, requestId: newRequestId() } }));
        break;
      case "signedOut":
        publish(update(items, current.key, { status: "failed", problem: "signedOut" }));
        halted = "signedOut";
        break;
      case "offline":
        publish(update(items, current.key, { status: "failed", problem: "offline" }));
        halted = "offline";
        break;
      case "unconfirmed":
        // It may exist: the same key is kept, so a retry returns that task instead of making a second.
        publish(update(items, current.key, { status: "failed", problem: "unconfirmed" }));
        halted = "unconfirmed";
        break;
    }
  }

  // Anything still marked "creating" (only possible if the loop was interrupted) did not get an answer.
  if (items.some((item) => item.status === "creating")) {
    items = items.map((item) => (item.status === "creating" ? { ...item, status: "ready" } : item));
  }
  return { items, halted };
}

/** One batch at a time: a second tap while the first is running does nothing. */
export function useBatchCreate() {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);

  const run = useCallback(async (items: BatchItem[], context: BatchContext): Promise<BatchResult | null> => {
    if (lock.current) return null;
    lock.current = true;
    setBusy(true);
    try {
      return await submitBatch(items, context);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }, []);

  return { busy, run };
}
