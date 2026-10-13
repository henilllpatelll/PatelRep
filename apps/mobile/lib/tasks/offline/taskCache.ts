import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Task } from "@/lib/api/tasks";

/* ─── Offline task cache ─────────────────────────────────────────────────────
   What lets the Tasks screen keep working without a connection: the last good My Work list,
   the details of those tasks, the first page of completed history and the Done Today count.

   Storage: AsyncStorage (plain, app-sandboxed; NOT encrypted — no stronger guarantee is claimed).
   Scope: one record per `${tenant_id}:${user_id}`; a record is only ever read for that exact scope.
   Policy:
   * every section expires after CACHE_MAX_AGE_MS (72 h) and is then ignored and removed;
   * a record with another schema version, scope or shape is discarded (never half-trusted);
   * comments / activity text and guest names are NOT cached — only the operational task row;
   * details are kept only for tasks still in My Work or in the cached history page (size bound);
   * the Available pool is never cached: offline it must not look claimable;
   * a missing / expired / corrupt record is "unknown", never "no tasks". */

export const TASK_CACHE_VERSION = 1;
export const CACHE_MAX_AGE_MS = 72 * 60 * 60 * 1000;
export const HISTORY_CACHE_LIMIT = 60;
export const TASK_CACHE_PREFIX = "@patelrep/task_cache/v1/";

export interface CachedList {
  tasks: Task[];
  truncated: boolean;
  syncedAt: string;
}

export interface CachedHistory {
  tasks: Task[];
  nextCursor: string | null;
  hasMore: boolean;
  syncedAt: string;
}

export interface CachedDone {
  count: number;
  atLeast: boolean;
  /** Hotel-local day (YYYY-MM-DD) the count belongs to; a count from another day is never shown. */
  day: string;
  syncedAt: string;
}

export interface TaskCache {
  version: number;
  scope: string;
  hotelTimezone: string | null;
  mine: CachedList | null;
  details: Record<string, { task: Task; cachedAt: string }>;
  history: CachedHistory | null;
  doneToday: CachedDone | null;
}

export function taskScope(user: { id: string; tenant_id?: string | null } | null | undefined): string | null {
  return user?.id && user.tenant_id ? `${user.tenant_id}:${user.id}` : null;
}

export function emptyCache(scope: string): TaskCache {
  return { version: TASK_CACHE_VERSION, scope, hotelTimezone: null, mine: null, details: {}, history: null, doneToday: null };
}

/** The operational fields only: no comments, no activity, no client-only sync flag. */
export function slimTask(task: Task): Task {
  const { comments: _comments, sync_state: _syncState, ...rest } = task;
  return rest as Task;
}

function isTask(value: unknown): value is Task {
  const task = value as Partial<Task> | null;
  return !!task && typeof task === "object" && typeof task.id === "string" && typeof task.title === "string" && typeof task.status === "string";
}

function isFresh(syncedAt: unknown, now: number): syncedAt is string {
  if (typeof syncedAt !== "string") return false;
  const at = new Date(syncedAt).getTime();
  return !Number.isNaN(at) && now - at <= CACHE_MAX_AGE_MS && at <= now + 5 * 60 * 1000;
}

/** Validate a parsed record; anything that does not fit is dropped section by section. */
export function sanitizeCache(raw: unknown, scope: string, now: number = Date.now()): TaskCache | null {
  const record = raw as Partial<TaskCache> | null;
  if (!record || typeof record !== "object") return null;
  if (record.version !== TASK_CACHE_VERSION || record.scope !== scope) return null;
  const cache = emptyCache(scope);
  cache.hotelTimezone = typeof record.hotelTimezone === "string" ? record.hotelTimezone : null;

  const mine = record.mine;
  if (mine && Array.isArray(mine.tasks) && isFresh(mine.syncedAt, now)) {
    cache.mine = { tasks: mine.tasks.filter(isTask), truncated: mine.truncated === true, syncedAt: mine.syncedAt };
  }
  const history = record.history;
  if (history && Array.isArray(history.tasks) && isFresh(history.syncedAt, now)) {
    cache.history = {
      tasks: history.tasks.filter(isTask),
      nextCursor: typeof history.nextCursor === "string" ? history.nextCursor : null,
      hasMore: history.hasMore === true,
      syncedAt: history.syncedAt,
    };
  }
  const done = record.doneToday;
  if (done && typeof done.count === "number" && typeof done.day === "string" && isFresh(done.syncedAt, now)) {
    cache.doneToday = { count: done.count, atLeast: done.atLeast === true, day: done.day, syncedAt: done.syncedAt };
  }
  if (record.details && typeof record.details === "object") {
    for (const [id, entry] of Object.entries(record.details)) {
      if (entry && isTask(entry.task) && entry.task.id === id && isFresh(entry.cachedAt, now)) cache.details[id] = entry;
    }
  }
  return cache;
}

// All reads and writes go through one chain so two quick updates never overwrite each other.
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

async function load(scope: string): Promise<TaskCache> {
  const key = TASK_CACHE_PREFIX + scope;
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return emptyCache(scope);
    const cache = sanitizeCache(JSON.parse(raw), scope);
    if (cache) return cache;
  } catch {
    // unreadable / corrupt: fall through and discard it
  }
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    // nothing more can be done
  }
  return emptyCache(scope);
}

/** Read the cache for exactly this scope. Never throws; a bad record comes back empty. */
export function readTaskCache(scope: string): Promise<TaskCache> {
  return serial(() => load(scope));
}

/** Read-modify-write one scope. Failures are swallowed: the cache is an optimisation, never a dependency. */
export function updateTaskCache(scope: string, change: (cache: TaskCache) => TaskCache): Promise<void> {
  return serial(async () => {
    try {
      const next = change(await load(scope));
      await AsyncStorage.setItem(TASK_CACHE_PREFIX + scope, JSON.stringify(next));
    } catch (error) {
      console.warn("[task-cache] could not save", error instanceof Error ? error.message : "unknown");
    }
  });
}

function keepDetails(cache: TaskCache, keep: Set<string>, fresh: Task[], at: string): TaskCache["details"] {
  const details: TaskCache["details"] = {};
  for (const [id, entry] of Object.entries(cache.details)) if (keep.has(id)) details[id] = entry;
  for (const task of fresh) details[task.id] = { task: slimTask(task), cachedAt: at };
  return details;
}

export function saveMyWork(scope: string, tasks: Task[], truncated: boolean, hotelTimezone: string | null): Promise<void> {
  return updateTaskCache(scope, (cache) => {
    const at = new Date().toISOString();
    const slim = tasks.map(slimTask);
    const keep = new Set([...slim.map((task) => task.id), ...(cache.history?.tasks ?? []).map((task) => task.id)]);
    return {
      ...cache,
      hotelTimezone: hotelTimezone ?? cache.hotelTimezone,
      mine: { tasks: slim, truncated, syncedAt: at },
      details: keepDetails(cache, keep, tasks, at),
    };
  });
}

export function saveHistoryFirstPage(scope: string, page: { tasks: Task[]; nextCursor: string | null; hasMore: boolean }): Promise<void> {
  return updateTaskCache(scope, (cache) => {
    const at = new Date().toISOString();
    const tasks = page.tasks.slice(0, HISTORY_CACHE_LIMIT).map(slimTask);
    const keep = new Set([...tasks.map((task) => task.id), ...(cache.mine?.tasks ?? []).map((task) => task.id)]);
    return {
      ...cache,
      history: { tasks, nextCursor: tasks.length < page.tasks.length ? null : page.nextCursor, hasMore: page.hasMore || tasks.length < page.tasks.length, syncedAt: at },
      details: keepDetails(cache, keep, tasks, at),
    };
  });
}

export function saveDoneToday(scope: string, value: { count: number; atLeast: boolean }, day: string): Promise<void> {
  return updateTaskCache(scope, (cache) => ({
    ...cache,
    doneToday: { count: value.count, atLeast: value.atLeast, day, syncedAt: new Date().toISOString() },
  }));
}

/** A cached task row for the detail sheet, or null. */
export function cachedDetail(cache: TaskCache | null, taskId: string): { task: Task; cachedAt: string } | null {
  return cache?.details[taskId] ?? null;
}

/** Sign-out / account switch: remove every cached task record on the device. */
export function clearAllTaskCaches(): Promise<void> {
  return serial(async () => {
    try {
      const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(TASK_CACHE_PREFIX));
      if (keys.length > 0) await AsyncStorage.multiRemove(keys);
    } catch (error) {
      console.warn("[task-cache] could not clear", error instanceof Error ? error.message : "unknown");
    }
  });
}

/** Remove cache records that belong to anyone but `scope` (a leftover from a previous sign-in). */
export function pruneForeignTaskCaches(scope: string): Promise<void> {
  return serial(async () => {
    try {
      const own = TASK_CACHE_PREFIX + scope;
      const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(TASK_CACHE_PREFIX) && key !== own);
      if (keys.length > 0) await AsyncStorage.multiRemove(keys);
    } catch {
      // best effort; reads are scope-keyed regardless
    }
  });
}
