import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { completeTask, fetchTask, TASK_NOTE_MAX, type Task } from "@/lib/api/tasks";
import { useAppStore } from "@/stores/appStore";
import { taskScope, slimTask, updateTaskCache, pruneForeignTaskCaches } from "@/lib/tasks/offline/taskCache";
import {
  backoffMs,
  checkQueueable,
  classifyCompletionError,
  isCompletedForMe,
  MAX_TRANSIENT_ATTEMPTS,
  newMutationId,
  OUTBOX_EXPIRY_MS,
  OUTBOX_MAX_ENTRIES,
  replayConflict,
  canRetryConflict,
  type OutboxEntry,
  type QueueRefusal,
} from "@/lib/tasks/offline/outboxPolicy";
import type { Viewer } from "@/lib/tasks/taskActions";

/* ─── Task outbox: completions saved on this device until the server confirms them ───
   One entry per task, persisted per `${tenant}:${user}` BEFORE the UI says "saved". Replay:
   * runs only for the signed-in user/hotel that queued it (identity re-checked per entry and again
     after every await) — another account never sends, sees or clears it;
   * goes through POST /tasks/{id}/complete, which re-checks assignment, role, blockers and state;
     that endpoint is replay-safe (an already-completed task answers 200 with meta.replayed and the
     note rides with the first successful call), so a lost reply followed by a retry never double-writes;
   * is single-flight, bounded (exponential backoff, attempt ceiling) and never spins on a refusal;
   * never edits local task state: an entry leaves only when the server confirmed it (or the person
     reviewed and dismissed a refused one).
   No tokens or credentials are stored; auth is attached at send time by the API client. */

export const OUTBOX_VERSION = 1;
export const OUTBOX_PREFIX = "@patelrep/task_outbox/v1/";

export type EnqueueResult = { ok: true; entry: OutboxEntry } | { ok: false; reason: QueueRefusal };

interface OutboxState {
  /** Scope the in-memory entries belong to; null until hydrated / signed out. */
  scope: string | null;
  entries: Record<string, OutboxEntry>;
  hydrated: boolean;
  /** Task ids being sent right now (not persisted). */
  sending: Record<string, true>;
  /** Bumped whenever a server confirmation or a conflict changed what the lists should show. */
  settledTick: number;
  /** ISO time the last queued item was confirmed by the server. */
  lastConfirmedAt: string | null;
  hydrate: () => Promise<boolean>;
  enqueueComplete: (task: Task, note: string) => Promise<EnqueueResult>;
  flush: () => Promise<void>;
  /** Explicit retry of a refused / exhausted item (only when the policy says that is safe). */
  retry: (taskId: string) => Promise<boolean>;
  /** Drop a refused item the employee has reviewed. Pending items can not be dismissed. */
  dismiss: (taskId: string) => Promise<boolean>;
}

function currentUser() {
  const user = useAppStore.getState().user;
  const scope = taskScope(user);
  return user && scope ? { user, scope } : null;
}

function viewerOf(user: { id: string; role?: string | null }): Viewer {
  return { userId: user.id, role: user.role ?? null };
}

function parseEntries(raw: string | null, scope: string, now: number): Record<string, OutboxEntry> {
  if (!raw) return {};
  const [tenantId, userId] = [scope.slice(0, scope.indexOf(":")), scope.slice(scope.indexOf(":") + 1)];
  let parsed: { version?: unknown; scope?: unknown; entries?: unknown } | null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || parsed.version !== OUTBOX_VERSION || parsed.scope !== scope || typeof parsed.entries !== "object" || !parsed.entries) return {};
  const out: Record<string, OutboxEntry> = {};
  for (const value of Object.values(parsed.entries as Record<string, Partial<OutboxEntry>>)) {
    const ok =
      value &&
      value.op === "complete" &&
      typeof value.taskId === "string" &&
      typeof value.mutationId === "string" &&
      value.userId === userId &&
      value.tenantId === tenantId &&
      typeof value.queuedAt === "string" &&
      !!value.task &&
      (value.task as Task).id === value.taskId;
    if (!ok) continue;
    const entry = value as OutboxEntry;
    const age = now - new Date(entry.queuedAt).getTime();
    out[entry.taskId] =
      entry.state === "pending" && age > OUTBOX_EXPIRY_MS
        ? { ...entry, state: "failed", nextAttemptAt: null, conflict: { reason: "expired", at: new Date(now).toISOString() } }
        : entry;
  }
  return out;
}

let inflight: Promise<void> | null = null;

export const useTaskOutbox = create<OutboxState>((set, get) => {
  async function persist(scope: string, entries: Record<string, OutboxEntry>): Promise<void> {
    const key = OUTBOX_PREFIX + scope;
    if (Object.keys(entries).length === 0) await AsyncStorage.removeItem(key);
    else await AsyncStorage.setItem(key, JSON.stringify({ version: OUTBOX_VERSION, scope, entries }));
  }

  /** Switch the in-memory view to the signed-in scope; false when nobody is signed in. */
  async function ensureScope(): Promise<boolean> {
    const me = currentUser();
    if (!me) {
      if (get().scope !== null) set({ scope: null, entries: {}, hydrated: false, sending: {} });
      return false;
    }
    if (get().scope === me.scope && get().hydrated) return true;
    let entries: Record<string, OutboxEntry> = {};
    try {
      entries = parseEntries(await AsyncStorage.getItem(OUTBOX_PREFIX + me.scope), me.scope, Date.now());
    } catch {
      entries = {};
    }
    // The person may have switched while storage was read: only adopt it for the scope that is still current.
    if (currentUser()?.scope !== me.scope) return false;
    set({ scope: me.scope, entries, hydrated: true, sending: {} });
    void pruneForeignTaskCaches(me.scope);
    return true;
  }

  async function update(scope: string, change: (entries: Record<string, OutboxEntry>) => Record<string, OutboxEntry>): Promise<boolean> {
    if (get().scope !== scope || currentUser()?.scope !== scope) return false;
    const next = change(get().entries);
    await persist(scope, next);
    if (get().scope !== scope) return false;
    set({ entries: next });
    return true;
  }

  async function settleOne(scope: string, entry: OutboxEntry): Promise<"stop" | "next"> {
    const me = currentUser();
    // Never replay under another identity (account or hotel switch, sign-out).
    if (!me || me.scope !== scope || entry.userId !== me.user.id || entry.tenantId !== me.user.tenant_id) return "stop";
    const viewer = viewerOf(me.user);
    set((state) => ({ sending: { ...state.sending, [entry.taskId]: true } }));
    try {
      let outcome: ReturnType<typeof classifyCompletionError> | null = null;
      try {
        await completeTask(entry.taskId, entry.note ?? undefined);
      } catch (error) {
        outcome = classifyCompletionError(error);
      }
      // The session may have changed during the request; the result then belongs to nobody here.
      if (currentUser()?.scope !== scope) return "stop";
      const now = new Date().toISOString();

      if (!outcome) return (await confirm(scope, entry.taskId)) ? "next" : "stop";
      if (outcome.kind === "auth") return "stop";

      if (outcome.kind === "retry") {
        const attempts = entry.attempts + 1;
        const exhausted = attempts >= MAX_TRANSIENT_ATTEMPTS;
        const status = outcome.status;
        await update(scope, (entries) =>
          entries[entry.taskId]
            ? {
                ...entries,
                [entry.taskId]: {
                  ...entries[entry.taskId],
                  attempts,
                  lastAttemptAt: now,
                  nextAttemptAt: exhausted ? null : new Date(Date.now() + backoffMs(attempts, status)).toISOString(),
                  state: exhausted ? "failed" : "pending",
                },
              }
            : entries,
        );
        // An unreachable server will not answer the next item either.
        return status === null ? "stop" : "next";
      }
      const refused = outcome;

      // A definitive refusal: read what the server now says, then either reconcile or explain.
      let current: Task | null | undefined;
      try {
        current = await fetchTask(entry.taskId);
      } catch (readError) {
        const status = (readError as { status?: unknown } | null)?.status;
        current = status === 404 || status === 403 ? null : undefined;
      }
      if (currentUser()?.scope !== scope) return "stop";
      if (isCompletedForMe(current, viewer)) return (await confirm(scope, entry.taskId)) ? "next" : "stop";
      const reason = replayConflict(refused.status, refused.errorCode, current, viewer);
      await update(scope, (entries) =>
        entries[entry.taskId]
          ? {
              ...entries,
              [entry.taskId]: {
                ...entries[entry.taskId],
                task: current ? slimTask(current) : entries[entry.taskId].task,
                attempts: entry.attempts + 1,
                lastAttemptAt: now,
                nextAttemptAt: null,
                state: "conflict",
                conflict: { reason, at: now },
              },
            }
          : entries,
      );
      set((state) => ({ settledTick: state.settledTick + 1 }));
      return "next";
    } finally {
      set((state) => {
        const sending = { ...state.sending };
        delete sending[entry.taskId];
        return { sending };
      });
    }
  }

  async function confirm(scope: string, taskId: string): Promise<boolean> {
    const done = await update(scope, (entries) => {
      const next = { ...entries };
      delete next[taskId];
      return next;
    });
    // The device no longer shows this task as unfinished work after a restart either.
    void updateTaskCache(scope, (cache) => {
      const details = { ...cache.details };
      delete details[taskId];
      return { ...cache, mine: cache.mine ? { ...cache.mine, tasks: cache.mine.tasks.filter((task) => task.id !== taskId) } : null, details };
    });
    set((state) => ({ settledTick: state.settledTick + 1, lastConfirmedAt: new Date().toISOString() }));
    return done;
  }

  return {
    scope: null,
    entries: {},
    hydrated: false,
    sending: {},
    settledTick: 0,
    lastConfirmedAt: null,

    hydrate: () => ensureScope(),

    enqueueComplete: async (task, note) => {
      if (!(await ensureScope())) return { ok: false, reason: "no_session" };
      const me = currentUser();
      if (!me || get().scope !== me.scope) return { ok: false, reason: "no_session" };
      const refusal = checkQueueable(task, viewerOf(me.user), get().entries, note, TASK_NOTE_MAX);
      if (refusal) return { ok: false, reason: refusal };
      if (Object.keys(get().entries).length >= OUTBOX_MAX_ENTRIES) return { ok: false, reason: "storage" };
      const entry: OutboxEntry = {
        mutationId: newMutationId(),
        op: "complete",
        taskId: task.id,
        userId: me.user.id,
        tenantId: me.user.tenant_id,
        task: slimTask(task),
        note: note.trim() ? note.trim() : null,
        observedStatus: task.status,
        observedAssignee: task.assigned_to,
        queuedAt: new Date().toISOString(),
        attempts: 0,
        lastAttemptAt: null,
        nextAttemptAt: null,
        state: "pending",
        conflict: null,
      };
      try {
        // Durable first: the screen may only say "saved on this device" once this has been written.
        const written = await update(me.scope, (entries) => (entries[task.id] ? entries : { ...entries, [task.id]: entry }));
        return written ? { ok: true, entry } : { ok: false, reason: "no_session" };
      } catch {
        return { ok: false, reason: "storage" };
      }
    },

    flush: () => {
      if (inflight) return inflight;
      inflight = (async () => {
        if (!(await ensureScope())) return;
        if (!useAppStore.getState().isOnline) return;
        const scope = get().scope;
        if (!scope) return;
        const now = Date.now();
        const due = Object.values(get().entries)
          .filter((entry) => entry.state === "pending" && (!entry.nextAttemptAt || new Date(entry.nextAttemptAt).getTime() <= now))
          .sort((a, b) => (a.queuedAt < b.queuedAt ? -1 : a.queuedAt > b.queuedAt ? 1 : 0));
        for (const entry of due) {
          if (!useAppStore.getState().isOnline) break;
          if ((await settleOne(scope, entry)) === "stop") break;
        }
      })()
        .catch((error) => console.warn("[task-outbox] flush failed", error instanceof Error ? error.message : "unknown"))
        .finally(() => {
          inflight = null;
        });
      return inflight;
    },

    retry: async (taskId) => {
      const scope = get().scope;
      const entry = get().entries[taskId];
      if (!scope || !entry || entry.state === "pending") return false;
      if (entry.state === "conflict" && !canRetryConflict(entry.conflict?.reason)) return false;
      const ok = await update(scope, (entries) => ({
        ...entries,
        [taskId]: { ...entries[taskId], state: "pending", attempts: 0, nextAttemptAt: null, conflict: null },
      }));
      if (ok) void get().flush();
      return ok;
    },

    dismiss: async (taskId) => {
      const scope = get().scope;
      const entry = get().entries[taskId];
      if (!scope || !entry || entry.state === "pending") return false;
      const ok = await update(scope, (entries) => {
        const next = { ...entries };
        delete next[taskId];
        return next;
      });
      if (ok) set((state) => ({ settledTick: state.settledTick + 1 }));
      return ok;
    },
  };
});

// Sign-out or an account / hotel switch: stop exposing the previous person's queue at once. The saved
// record stays on disk under its own scope key (never read or replayed for anyone else).
if (typeof useAppStore.subscribe === "function") {
  useAppStore.subscribe((state, previous) => {
    if (taskScope(state.user) !== taskScope(previous.user)) {
      useTaskOutbox.setState({ scope: null, entries: {}, hydrated: false, sending: {} });
    }
  });
}

/** Entries that belong to the person using the phone right now (never another scope's). */
const NO_ENTRIES: Record<string, OutboxEntry> = Object.freeze({}) as Record<string, OutboxEntry>;
export function entriesForCurrentUser(state: Pick<OutboxState, "scope" | "entries">): Record<string, OutboxEntry> {
  const me = currentUser();
  return me && state.scope === me.scope ? state.entries : NO_ENTRIES;
}

export function flushTaskOutbox(): Promise<void> {
  return useTaskOutbox.getState().flush();
}
