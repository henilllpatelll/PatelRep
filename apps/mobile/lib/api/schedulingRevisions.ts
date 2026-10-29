import { api } from "./client";

/* ─── Drafts, review and publishing (Team Scheduling Phase 7) ───────────────
   Every function is a real server call; nothing is held locally, so a screen can only say "published" after the server
   answered with the committed publication.

   Rules the callers rely on
     - A draft is NOT the schedule. Staging a change never changes a published shift and employees cannot see it.
     - `publish` is one server transaction. A repeated call with the same `idempotencyKey` returns the committed result
       (`replayed: true`) and applies nothing twice, so a lost response is recoverable by asking again.
     - "queued", "in app" and "accepted by the push provider" are different facts; none of them is "delivered to the phone".
     - Review is advice: publishing re-checks everything inside the transaction. */

type Raw = Record<string, unknown>;

function rec(value: unknown): Raw | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Raw) : null;
}
function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function keep<T>(items: Array<T | null>): T[] {
  return items.filter((item): item is T => item !== null);
}

/* ─── Model ───────────────────────────────────────────────────────────────── */

export type RevisionStatus = "draft" | "published" | "superseded" | "discarded";
export type ChangeKind = "create" | "update" | "cancel";

/** A shift as a person would read it: no notes, no reasons. */
export interface ShiftFace {
  userId: string;
  shiftId: string;
  shiftName: string | null;
  workDate: string;
  startTime: string | null;
  endTime: string | null;
}

/** The full proposed shift, used to draw a draft over the schedule. */
export interface ProposedShift extends ShiftFace {
  startsAt: string;
  endsAt: string;
  departmentId: string | null;
  notes: string | null;
}

export interface RevisionChange {
  id: string;
  kind: ChangeKind;
  assignmentId: string | null;
  baseVersion: number | null;
  before: ShiftFace | null;
  proposed: ProposedShift | null;
  reason: string | null;
}

export interface PublicationResult {
  publicationId: string;
  publishedAt: string | null;
  created: number;
  updated: number;
  cancelled: number;
  employeesAffected: number;
  notificationsQueued: number;
  replayed: boolean;
}

export interface Revision {
  id: string;
  departmentId: string;
  status: RevisionStatus;
  version: number;
  correctsRevisionId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  publishedAt: string | null;
  publishedByName: string | null;
  result: PublicationResult | null;
  /** Present when the call returns the changes (drafts, details). */
  changes: RevisionChange[] | null;
}

export function parseFace(raw: unknown): ShiftFace | null {
  const row = rec(raw);
  const userId = row ? str(row.user_id) : null;
  const workDate = row ? str(row.work_date) : null;
  if (!row || !userId || !workDate) return null;
  return {
    userId, shiftId: str(row.shift_id) ?? "", shiftName: str(row.shift_name), workDate: workDate.slice(0, 10),
    startTime: str(row.start_time), endTime: str(row.end_time),
  };
}

export function parseProposed(raw: unknown): ProposedShift | null {
  const row = rec(raw);
  const face = parseFace(raw);
  const startsAt = row ? str(row.starts_at) : null;
  const endsAt = row ? str(row.ends_at) : null;
  if (!row || !face || !startsAt || !endsAt) return null;
  return { ...face, startsAt, endsAt, departmentId: str(row.department_id), notes: str(row.notes) };
}

export function parseChange(raw: unknown): RevisionChange | null {
  const row = rec(raw);
  const id = row ? str(row.id) : null;
  const kind = row ? str(row.kind) : null;
  if (!row || !id || (kind !== "create" && kind !== "update" && kind !== "cancel")) return null;
  const proposed = parseProposed(row.proposed);
  if (kind !== "cancel" && !proposed) return null;
  return { id, kind, assignmentId: str(row.assignment_id), baseVersion: num(row.base_version), before: parseFace(row.before), proposed, reason: str(row.reason) };
}

function parseResult(raw: unknown): PublicationResult | null {
  const row = rec(raw);
  const id = row ? str(row.publication_id) : null;
  if (!row || !id) return null;
  return {
    publicationId: id, publishedAt: str(row.published_at), created: num(row.created) ?? 0, updated: num(row.updated) ?? 0,
    cancelled: num(row.cancelled) ?? 0, employeesAffected: num(row.employees_affected) ?? 0,
    notificationsQueued: num(row.notifications_queued) ?? 0, replayed: row.replayed === true,
  };
}

export function parseRevision(raw: unknown): Revision | null {
  const row = rec(raw);
  const id = row ? str(row.id) : null;
  const status = row ? str(row.status) : null;
  const version = row ? num(row.version) : null;
  if (!row || !id || version === null || (status !== "draft" && status !== "published" && status !== "superseded" && status !== "discarded")) return null;
  return {
    id, departmentId: str(row.department_id) ?? "", status, version, correctsRevisionId: str(row.corrects_revision_id),
    createdAt: str(row.created_at), updatedAt: str(row.updated_at), publishedAt: str(row.published_at),
    publishedByName: str(row.published_by_name), result: parseResult(row.result),
    changes: Array.isArray(row.changes) ? keep(row.changes.map(parseChange)) : null,
  };
}

function dataOf(body: unknown, what: string): Raw {
  const root = rec(body);
  const data = root ? rec(root.data) : null;
  if (!data) throw new Error(`${what} response was not in the expected shape.`);
  return data;
}

/* ─── Drafts ──────────────────────────────────────────────────────────────── */

export async function fetchDrafts(): Promise<Revision[]> {
  const root = rec(await api.get<unknown>("/schedules/revisions/drafts"));
  return keep(list(root?.data).map(parseRevision));
}

export interface StageInput {
  kind: ChangeKind;
  /** Update / cancel of a published shift. */
  assignmentId?: string;
  expectedVersion?: number;
  /** Update / cancel of a shift that only exists in the draft. */
  changeId?: string;
  /** Stable per form submission, so a retry replaces itself instead of adding a second shift. */
  clientKey?: string;
  userId?: string;
  shiftId?: string;
  workDate?: string;
  startTime?: string;
  endTime?: string;
  notes?: string | null;
  reason?: string;
}

export interface StageOutcome {
  revision: Revision | null;
  action: "insert" | "replace" | "delete" | "noop";
}

export async function stageChange(input: StageInput): Promise<StageOutcome> {
  const body: Raw = { kind: input.kind };
  if (input.assignmentId) body.assignment_id = input.assignmentId;
  if (input.changeId) body.change_id = input.changeId;
  if (input.clientKey) body.client_key = input.clientKey;
  if (input.expectedVersion !== undefined) body.expected_version = input.expectedVersion;
  if (input.userId) body.user_id = input.userId;
  if (input.shiftId) body.shift_id = input.shiftId;
  if (input.workDate) body.work_date = input.workDate;
  if (input.startTime) body.start_time = input.startTime;
  if (input.endTime) body.end_time = input.endTime;
  if (input.notes !== undefined) body.notes = input.notes ?? "";
  if (input.reason) body.reason = input.reason;
  const data = dataOf(await api.post<unknown>("/schedules/revisions/changes", body), "Draft");
  const action = str(data.action);
  return { revision: parseRevision(data.revision), action: action === "insert" || action === "replace" || action === "delete" || action === "noop" ? action : "noop" };
}

export async function removeChange(revisionId: string, changeId: string): Promise<Revision> {
  const revision = parseRevision(dataOf(await api.delete<unknown>(`/schedules/revisions/${encodeURIComponent(revisionId)}/changes/${encodeURIComponent(changeId)}`), "Draft"));
  if (!revision) throw new Error("Draft response was not in the expected shape.");
  return revision;
}

export async function discardRevision(revisionId: string, expectedVersion: number): Promise<void> {
  dataOf(await api.post<unknown>(`/schedules/revisions/${encodeURIComponent(revisionId)}/discard`, { expected_version: expectedVersion }), "Draft");
}

export async function startCorrection(revisionId: string): Promise<Revision> {
  const revision = parseRevision(dataOf(await api.post<unknown>(`/schedules/revisions/${encodeURIComponent(revisionId)}/correct`, {}), "Correction"));
  if (!revision) throw new Error("Correction response was not in the expected shape.");
  return revision;
}

/* ─── Review ──────────────────────────────────────────────────────────────── */

export type ImpactKind = "added" | "changed" | "cancelled" | "removed";

export interface ImpactItem {
  kind: ImpactKind;
  changeId: string;
  workDate: string;
  before: ShiftFace | null;
  after: ShiftFace | null;
  reason: string | null;
}

export interface ImpactPerson {
  userId: string;
  name: string;
  items: ImpactItem[];
}

export interface ReviewIssue {
  code: string;
  changeId: string | null;
  userId: string | null;
  workDate: string | null;
  detail: string | null;
  /** For a stale shift: the published value now. */
  current: ShiftFace | null;
  currentVersion: number | null;
}

export interface ReviewSummary {
  created: number;
  modified: number;
  cancelled: number;
  reassigned: number;
  employeesAffected: number;
  totalChanges: number;
}

export interface Review {
  revision: Revision;
  department: string | null;
  summary: ReviewSummary;
  dateRange: { from: string; to: string } | null;
  impact: ImpactPerson[];
  blocking: ReviewIssue[];
  warnings: ReviewIssue[];
  /** `available: false` is the honest answer when no staffing projection can be made. */
  forecast: { available: boolean; reason: string | null };
  canPublish: boolean;
}

function parseIssue(raw: unknown): ReviewIssue | null {
  const row = rec(raw);
  const code = row ? str(row.code) : null;
  if (!row || !code) return null;
  return { code, changeId: str(row.change_id), userId: str(row.user_id), workDate: str(row.work_date), detail: str(row.detail), current: parseFace(row.current), currentVersion: num(row.current_version) };
}

function parseImpactItem(raw: unknown): ImpactItem | null {
  const row = rec(raw);
  const kind = row ? str(row.kind) : null;
  const changeId = row ? str(row.change_id) : null;
  const workDate = row ? str(row.work_date) : null;
  if (!row || !changeId || !workDate || (kind !== "added" && kind !== "changed" && kind !== "cancelled" && kind !== "removed")) return null;
  return { kind, changeId, workDate, before: parseFace(row.before), after: parseFace(row.after), reason: str(row.reason) };
}

export function parseReview(body: unknown): Review {
  const data = dataOf(body, "Review");
  const revision = parseRevision(data.revision);
  const summary = rec(data.summary);
  if (!revision || !summary) throw new Error("Review response was not in the expected shape.");
  const range = rec(data.date_range);
  const forecast = rec(data.forecast);
  return {
    revision,
    department: str(data.department),
    summary: {
      created: num(summary.new) ?? 0, modified: num(summary.modified) ?? 0, cancelled: num(summary.cancelled) ?? 0,
      reassigned: num(summary.reassigned) ?? 0, employeesAffected: num(summary.employees_affected) ?? 0, totalChanges: num(summary.total_changes) ?? 0,
    },
    dateRange: range && str(range.from) && str(range.to) ? { from: str(range.from) as string, to: str(range.to) as string } : null,
    impact: keep(list(data.impact).map((raw): ImpactPerson | null => {
      const row = rec(raw);
      const userId = row ? str(row.user_id) : null;
      return row && userId ? { userId, name: str(row.name) ?? "", items: keep(list(row.items).map(parseImpactItem)) } : null;
    })),
    blocking: keep(list(data.blocking).map(parseIssue)),
    warnings: keep(list(data.warnings).map(parseIssue)),
    forecast: { available: forecast?.available === true, reason: forecast ? str(forecast.reason) : null },
    canPublish: data.can_publish === true,
  };
}

export async function fetchReview(revisionId: string): Promise<Review> {
  return parseReview(await api.get<unknown>(`/schedules/revisions/${encodeURIComponent(revisionId)}/review`));
}

/* ─── Publishing ──────────────────────────────────────────────────────────── */

export function newPublishKey(): string {
  return `publish-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** One key per publish ATTEMPT SERIES: reuse it when retrying after a lost answer. */
export async function publishRevision(revisionId: string, expectedVersion: number, idempotencyKey: string): Promise<PublicationResult> {
  const body = await api.post<unknown>(`/schedules/revisions/${encodeURIComponent(revisionId)}/publish`, {
    expected_version: expectedVersion, idempotency_key: idempotencyKey, confirm: true,
  });
  const result = parseResult(dataOf(body, "Publication"));
  if (!result) throw new Error("Publication response was not in the expected shape.");
  return result;
}

export type NotificationState = "none" | "processing" | "in_app_available" | "failed";

export interface NotificationStatus {
  state: NotificationState;
  total: number;
  queued: number;
  inApp: number;
  failed: number;
  pushAccepted: number;
  pushFailed: number;
  noDevice: number;
  optedOut: number;
  failures: { userId: string; name: string; retryable: boolean }[];
}

export function parseNotificationStatus(body: unknown): NotificationStatus {
  const data = dataOf(body, "Notification status");
  const by = rec(data.by_status) ?? {};
  const push = rec(data.push) ?? {};
  const state = str(data.state);
  return {
    state: state === "processing" || state === "in_app_available" || state === "failed" ? state : "none",
    total: num(data.total) ?? 0,
    queued: (num(by.queued) ?? 0) + (num(by.processing) ?? 0),
    inApp: num(data.in_app_available) ?? 0,
    failed: num(by.failed) ?? 0,
    pushAccepted: num(push.accepted) ?? 0,
    pushFailed: num(push.failed) ?? 0,
    noDevice: num(push.no_device) ?? 0,
    optedOut: num(push.opted_out) ?? 0,
    failures: keep(list(data.failed).map((raw) => {
      const row = rec(raw);
      const userId = row ? str(row.user_id) : null;
      return row && userId ? { userId, name: str(row.name) ?? "", retryable: row.retryable === true } : null;
    })),
  };
}

export async function fetchNotificationStatus(revisionId: string): Promise<NotificationStatus> {
  return parseNotificationStatus(await api.get<unknown>(`/schedules/revisions/${encodeURIComponent(revisionId)}/notifications`));
}

export async function retryNotifications(revisionId: string): Promise<number> {
  const data = dataOf(await api.post<unknown>(`/schedules/revisions/${encodeURIComponent(revisionId)}/notifications/retry`, {}), "Retry");
  return num(data.reset) ?? 0;
}

/* ─── History ─────────────────────────────────────────────────────────────── */

export async function fetchHistory(options: { status?: RevisionStatus; before?: string | null } = {}): Promise<{ items: Revision[]; next: string | null }> {
  const query = new URLSearchParams();
  if (options.status && options.status !== "draft") query.set("status", options.status);
  if (options.before) query.set("before", options.before);
  const suffix = query.toString();
  const root = rec(await api.get<unknown>(`/schedules/revisions${suffix ? `?${suffix}` : ""}`));
  return { items: keep(list(root?.data).map(parseRevision)), next: str(rec(root?.meta)?.next) };
}

export async function fetchRevision(revisionId: string): Promise<Revision> {
  const revision = parseRevision(dataOf(await api.get<unknown>(`/schedules/revisions/${encodeURIComponent(revisionId)}`), "Revision"));
  if (!revision) throw new Error("Revision response was not in the expected shape.");
  return revision;
}

export interface RevisionEvent {
  id: string;
  event: string;
  actorName: string | null;
  createdAt: string | null;
  count: number | null;
}

export async function fetchRevisionEvents(revisionId: string): Promise<RevisionEvent[]> {
  const root = rec(await api.get<unknown>(`/schedules/revisions/${encodeURIComponent(revisionId)}/events`));
  return keep(list(root?.data).map((raw): RevisionEvent | null => {
    const row = rec(raw);
    const id = row ? str(row.id) : null;
    const event = row ? str(row.event) : null;
    return row && id && event ? { id, event, actorName: str(row.actor_name), createdAt: str(row.created_at), count: num(rec(row.detail)?.count) } : null;
  }));
}

/* ─── Failures ────────────────────────────────────────────────────────────── */

export type PublishFailureKind =
  | "blocked"
  | "draft_changed"
  | "stale"
  | "already_published"
  | "closed"
  | "attendance"
  | "locked"
  | "commitment"
  | "leave"
  | "conflict"
  | "empty"
  | "forbidden"
  | "signed_out"
  /** No answer: the publication MAY have committed. Ask again with the same key before doing anything else. */
  | "unconfirmed"
  | "other";

export interface PublishFailure {
  kind: PublishFailureKind;
  status: number | null;
  code: string | null;
  blocking: ReviewIssue[];
}

const FAILURE_BY_CODE: Record<string, PublishFailureKind> = {
  publish_blocked: "blocked",
  revision_changed: "draft_changed",
  version_conflict: "stale",
  stale_shift: "stale",
  already_published: "already_published",
  revision_closed: "closed",
  revision_not_found: "closed",
  has_attendance: "attendance",
  historical_assignment_locked: "locked",
  coverage_commitment: "commitment",
  approved_time_off: "leave",
  schedule_conflict: "conflict",
  duplicate_assignment: "conflict",
  nothing_to_publish: "empty",
  department_forbidden: "forbidden",
};

/** Classify without `instanceof`, so it works when a test mocks the client module. */
export function classifyPublishFailure(error: unknown): PublishFailure {
  const raw = error as { status?: unknown; code?: unknown; body?: unknown } | null;
  const status = typeof raw?.status === "number" ? raw.status : null;
  const body = rec(raw?.body);
  const code = typeof raw?.code === "string" ? raw.code : body ? str(body.code) : null;
  const blocking = keep(list(body?.blocking).map(parseIssue));
  if (status === null || status >= 500) return { kind: "unconfirmed", status, code, blocking };
  if (status === 401) return { kind: "signed_out", status, code, blocking };
  const mapped = code ? FAILURE_BY_CODE[code] : undefined;
  if (mapped) return { kind: mapped, status, code, blocking };
  if (status === 403) return { kind: "forbidden", status, code, blocking };
  return { kind: "other", status, code, blocking };
}
