import { api } from "@/lib/api/client";

/**
 * Persistent clean-session model for the housekeeper My Rooms workflow.
 *
 * The server owns the session: it snapshots the hotel's configured checklist
 * at start (labels, sections, order, required flags) and is the only place a
 * clean can be completed. This module is the client's view of that contract
 * plus the pure helpers the store and screens share.
 */

export interface ChecklistItem {
  item_id: string | null;
  section: string;
  label: string;
  is_required: boolean;
  checked: boolean;
  checked_at: string | null;
}

export type ServerSessionStatus = "active" | "completed" | "abandoned";

/** Row shape returned by /clean-sessions (fields the app reads). */
export interface ServerCleanSession {
  id: string;
  room_id: string;
  housekeeper_id: string;
  clean_type: string | null;
  status: ServerSessionStatus;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  base_clean_minutes?: number | null;
  checklist: ChecklistItem[];
  checklist_done: number;
  checklist_total: number;
  notes?: string | null;
  linen_counts?: { dirty_out: number; clean_in: number } | null;
}

export type SessionConflictCode =
  | "DND_ACTIVE"
  | "SERVICE_DECLINED"
  | "ENTRY_PROTOCOL_REQUIRED"
  | "ROOM_NOT_ASSIGNED"
  | "ROOM_IN_USE"
  | "ACTIVE_SESSION_EXISTS"
  | "ROOM_NOT_STARTABLE"
  | "ROOM_STATE_CHANGED"
  | "SESSION_NOT_ACTIVE"
  | "SESSION_ABANDONED"
  | "SESSION_GONE"
  | "UNKNOWN";

export interface SessionConflict {
  code: SessionConflictCode;
  message: string;
  at: string;
}

/** Linen exchange for one clean. `saved` is what the server holds; the rest is device state. */
export interface LinenState {
  dirtyOut: number;
  cleanIn: number;
  /** Values the server has not confirmed yet. */
  pending: boolean;
  /** The last save was refused or failed; the counts stay on this device until re-saved. */
  failed: boolean;
}

export const LINEN_MAX = 99;

export function clampLinen(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(LINEN_MAX, Math.max(0, Math.trunc(value)));
}

/** Linen counts are only asked for on departure cleans (a full bed + bath strip). */
export function tracksLinen(cleanType: string | null | undefined): boolean {
  return cleanType === "DEP";
}

/** Everything the app keeps on disk for one room's clean. */
export interface LocalCleanSession {
  roomId: string;
  /** Stable client-generated id — the idempotency key for start. */
  sessionId: string;
  cleanType: string | null;
  startedAt: string;
  entryAcknowledged: boolean;
  checklist: ChecklistItem[];
  /**
   * True while the checklist came from the cached hotel template (offline
   * start). The server snapshot replaces it as soon as the start is confirmed.
   */
  provisional: boolean;
  /** Server has created (or resumed) this session. */
  startConfirmed: boolean;
  /** Item key -> checked state for edits the server has not confirmed yet. */
  pendingItems: Record<string, ChecklistItem>;
  /** ISO time the user finished locally; set until the server confirms. */
  completeRequestedAt: string | null;
  /** Server confirmed completion. Only then may the UI call the room clean. */
  completionConfirmed: boolean;
  /**
   * A completion request went out and the answer never arrived (timeout, dropped
   * connection). The outcome is unknown: reconcile with the server before resending.
   */
  completionUnsure?: boolean;
  endedAt: string | null;
  durationSeconds: number | null;
  /** Expected clean length from the room type; an estimate, never a deadline. */
  baseCleanMinutes?: number | null;
  linen?: LinenState;
  conflict: SessionConflict | null;
  /** Last actionable server rejection that is not a conflict (e.g. required items). */
  lastError: { code: string; message: string; missing?: string[] } | null;
  updatedAt: string;
}

export type SessionPhase =
  | "starting" // created locally, server has not confirmed yet
  | "active" // server-confirmed, being worked
  | "completing" // user finished, waiting for the server to confirm
  | "completed" // server confirmed
  | "conflict"; // server rejected; local work kept for recovery

export function getPhase(session: LocalCleanSession): SessionPhase {
  if (session.completionConfirmed) return "completed";
  if (session.conflict) return "conflict";
  if (session.completeRequestedAt) return "completing";
  if (!session.startConfirmed) return "starting";
  return "active";
}

/** True while there is local state the server has not confirmed. */
export function hasPendingSync(session: LocalCleanSession): boolean {
  if (session.completionConfirmed || session.conflict) return false;
  return (
    !session.startConfirmed ||
    Object.keys(session.pendingItems).length > 0 ||
    Boolean(session.linen?.pending) ||
    session.completeRequestedAt !== null
  );
}

/** Count of local changes the server has not confirmed (checklist edits + linen). */
export function pendingChangeCount(session: LocalCleanSession): number {
  return Object.keys(session.pendingItems).length + (session.linen?.pending ? 1 : 0);
}

export function itemKey(item: Pick<ChecklistItem, "item_id" | "section" | "label">): string {
  return item.item_id ? `id:${item.item_id}` : `label:${item.section}|${item.label}`;
}

function contentKey(item: Pick<ChecklistItem, "section" | "label">): string {
  return `${item.section}|${item.label}`;
}

export interface ChecklistProgress {
  done: number;
  total: number;
  requiredDone: number;
  requiredTotal: number;
  requiredRemaining: ChecklistItem[];
}

export function getProgress(checklist: ChecklistItem[]): ChecklistProgress {
  let done = 0;
  let requiredDone = 0;
  let requiredTotal = 0;
  const requiredRemaining: ChecklistItem[] = [];
  for (const item of checklist) {
    if (item.checked) done += 1;
    if (item.is_required) {
      requiredTotal += 1;
      if (item.checked) requiredDone += 1;
      else requiredRemaining.push(item);
    }
  }
  return { done, total: checklist.length, requiredDone, requiredTotal, requiredRemaining };
}

export interface ChecklistGroup {
  section: string;
  items: ChecklistItem[];
}

/** Group by section, keeping the configured order of first appearance. */
export function groupBySection(checklist: ChecklistItem[]): ChecklistGroup[] {
  const groups: ChecklistGroup[] = [];
  const index = new Map<string, ChecklistGroup>();
  for (const item of checklist) {
    let group = index.get(item.section);
    if (!group) {
      group = { section: item.section, items: [] };
      index.set(item.section, group);
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

/**
 * Re-apply local checked state onto a (new) authoritative checklist.
 *
 * `local` supplies state for items the user has touched; everything else keeps
 * the server's value so newer server state is never silently overwritten.
 * Matching falls back from item id to section+label because a provisional
 * (cached template) checklist can be older than the server snapshot.
 */
export function applyLocalState(
  server: ChecklistItem[],
  pending: Record<string, ChecklistItem>,
  carry: ChecklistItem[] = [],
): { checklist: ChecklistItem[]; pendingItems: Record<string, ChecklistItem> } {
  const carryById = new Map<string, ChecklistItem>();
  const carryByContent = new Map<string, ChecklistItem>();
  for (const item of carry) {
    if (item.item_id) carryById.set(item.item_id, item);
    carryByContent.set(contentKey(item), item);
  }
  const pendingById = new Map<string, ChecklistItem>();
  const pendingByContent = new Map<string, ChecklistItem>();
  for (const item of Object.values(pending)) {
    if (item.item_id) pendingById.set(item.item_id, item);
    pendingByContent.set(contentKey(item), item);
  }

  const nextPending: Record<string, ChecklistItem> = {};
  const checklist = server.map((item) => {
    const touched =
      (item.item_id ? pendingById.get(item.item_id) : undefined) ?? pendingByContent.get(contentKey(item));
    if (touched) {
      const merged = { ...item, checked: touched.checked, checked_at: touched.checked ? touched.checked_at : null };
      nextPending[itemKey(merged)] = merged;
      return merged;
    }
    const carried =
      (item.item_id ? carryById.get(item.item_id) : undefined) ?? carryByContent.get(contentKey(item));
    if (carried && carried.checked && !item.checked) {
      // Local-only state carried over from a provisional checklist: keep it, but
      // it still needs to reach the server.
      const merged = { ...item, checked: true, checked_at: carried.checked_at };
      nextPending[itemKey(merged)] = merged;
      return merged;
    }
    return item;
  });
  return { checklist, pendingItems: nextPending };
}

export function setItemChecked(
  session: LocalCleanSession,
  key: string,
  checked: boolean,
  now: string,
): LocalCleanSession {
  let changed: ChecklistItem | null = null;
  const checklist = session.checklist.map((item) => {
    if (itemKey(item) !== key || item.checked === checked) return item;
    changed = { ...item, checked, checked_at: checked ? now : null };
    return changed;
  });
  if (!changed) return session;
  const next: ChecklistItem = changed;
  return {
    ...session,
    checklist,
    pendingItems: { ...session.pendingItems, [key]: next },
    // Editing after a rejected completion re-opens the work; the stale error goes away.
    lastError: null,
    updatedAt: now,
  };
}

// ─── Hotel checklist templates (cached so a clean can start offline) ─────────

export interface ChecklistTemplate {
  id: string;
  clean_type: string;
  name: string;
  items: Array<{ id: string; section: string; label: string; is_required: boolean; sort_order?: number }>;
}

export function checklistFromTemplate(templates: ChecklistTemplate[], cleanType: string | null | undefined): ChecklistItem[] | null {
  const wanted = cleanType && ["DEP", "FULL", "LIGHT"].includes(cleanType) ? cleanType : "DEFAULT";
  const template =
    templates.find((candidate) => candidate.clean_type === wanted) ??
    templates.find((candidate) => candidate.clean_type === "DEFAULT");
  if (!template) return null;
  return [...template.items]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((item) => ({
      item_id: item.id,
      section: item.section || "General",
      label: item.label,
      is_required: Boolean(item.is_required),
      checked: false,
      checked_at: null,
    }));
}

// ─── Error classification ─────────────────────────────────────────────────────

interface ApiErrorLike {
  status: number;
  code?: string;
  detail?: unknown;
  message: string;
}

/** Duck-typed so it works across module boundaries (and when the client is mocked). */
export function isApiError(err: unknown): err is ApiErrorLike {
  return typeof err === "object" && err !== null && typeof (err as { status?: unknown }).status === "number";
}

export type FailureKind = "offline" | "retry" | "validation" | "conflict";

/**
 * - offline: the request never got an answer — keep the work queued
 * - retry: server hiccup (5xx/429/auth refresh) — keep queued, try again later
 * - validation: server understood and refused the completion (required items)
 * - conflict: server state moved on (reassigned, DND, completed elsewhere...)
 */
export function classifyFailure(err: unknown): { kind: FailureKind; code: SessionConflictCode | "REQUIRED_ITEMS_INCOMPLETE" | "UNKNOWN"; message: string; missing?: string[] } {
  if (!isApiError(err)) {
    return { kind: "offline", code: "UNKNOWN", message: err instanceof Error ? err.message : "Network error" };
  }
  const detail = err.detail as { missing?: string[] } | undefined;
  if (err.code === "REQUIRED_ITEMS_INCOMPLETE") {
    return { kind: "validation", code: "REQUIRED_ITEMS_INCOMPLETE", message: err.message, missing: detail?.missing };
  }
  if (err.status >= 500 || err.status === 429 || err.status === 408) {
    return { kind: "retry", code: "UNKNOWN", message: err.message };
  }
  if (err.status === 404) {
    return { kind: "conflict", code: "SESSION_GONE", message: err.message };
  }
  const code = (err.code as SessionConflictCode | undefined) ?? "UNKNOWN";
  return { kind: "conflict", code, message: err.message };
}

// ─── API ──────────────────────────────────────────────────────────────────────

/** Never adopt a response that isn't a real session: it would wipe local progress. */
function assertSession(value: unknown): ServerCleanSession {
  const candidate = value as Partial<ServerCleanSession> | null;
  if (
    !candidate ||
    typeof candidate.id !== "string" ||
    typeof candidate.room_id !== "string" ||
    !Array.isArray(candidate.checklist)
  ) {
    throw new Error("Unexpected clean-session response");
  }
  return candidate as ServerCleanSession;
}

export async function apiStartSession(input: {
  id: string;
  roomId: string;
  startedAt: string;
  entryAcknowledged: boolean;
}): Promise<ServerCleanSession> {
  const res = await api.post<{ data: ServerCleanSession }>("/clean-sessions", {
    id: input.id,
    room_id: input.roomId,
    started_at: input.startedAt,
    entry_acknowledged: input.entryAcknowledged,
  });
  return assertSession(res.data);
}

export async function apiGetActiveSession(): Promise<ServerCleanSession | null> {
  const res = await api.get<{ data: ServerCleanSession | null }>("/clean-sessions/active");
  return res.data ? assertSession(res.data) : null;
}

export async function apiGetSession(id: string): Promise<ServerCleanSession> {
  const res = await api.get<{ data: ServerCleanSession }>(`/clean-sessions/${id}`);
  return assertSession(res.data);
}

export async function apiPatchChecklist(id: string, items: ChecklistItem[]): Promise<ServerCleanSession> {
  const res = await api.patch<{ data: ServerCleanSession }>(`/clean-sessions/${id}`, { checklist: items });
  return assertSession(res.data);
}

export async function apiPatchLinen(id: string, counts: { dirtyOut: number; cleanIn: number }): Promise<ServerCleanSession> {
  const res = await api.patch<{ data: ServerCleanSession }>(`/clean-sessions/${id}`, {
    linen_counts: { dirty_out: clampLinen(counts.dirtyOut), clean_in: clampLinen(counts.cleanIn) },
  });
  return assertSession(res.data);
}

export async function apiCompleteSession(
  id: string,
  endedAt: string,
  items: ChecklistItem[],
): Promise<ServerCleanSession> {
  const body: Record<string, unknown> = { ended_at: endedAt };
  if (items.length > 0) body.checklist = items;
  const res = await api.post<{ data: ServerCleanSession }>(`/clean-sessions/${id}/complete`, body);
  // Completion is confirmed by the 2xx itself; the echoed row only supplies timing.
  return (res.data ?? {}) as ServerCleanSession;
}

export async function apiGetChecklistTemplates(): Promise<ChecklistTemplate[]> {
  const res = await api.get<{ data: ChecklistTemplate[] }>("/housekeeping/checklists");
  return res.data ?? [];
}

/** RFC 4122 v4 id; the backend validates UUID4 for client-generated session ids. */
export function newSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const hex = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < 36; i += 1) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += "-";
    else if (i === 14) out += "4";
    else if (i === 19) out += hex[(Math.random() * 4) | 8];
    else out += hex[(Math.random() * 16) | 0];
  }
  return out;
}
