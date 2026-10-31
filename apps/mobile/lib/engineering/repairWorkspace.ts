/* ─── Repair workspace domain logic ─────────────────────────────────────────
   Pure rules behind the work-order detail screen: which actions are offered, how labor is read from the
   server's sessions, how the activity timeline is assembled, and what a completion must contain. The server
   enforces every one of these (apps/api/routers/work_orders.py); nothing here grants a permission, it only
   decides what the screen offers and says. No i18n here — callers translate the keys. */

import { canActOnWorkOrders } from "@/lib/engineering/roles";
import {
  canTransitionWorkOrder,
  type WorkOrder,
  type WorkOrderComment,
  type WorkOrderPhoto,
} from "@/lib/engineering/workOrders";

/* ── Server records ───────────────────────────────────────────────────────── */

export type VerificationResult = "passed" | "failed" | "follow_up_required";
export type PhotoType = "before" | "progress" | "after";

/** A row of `work_order_labor_sessions`. `ended_at` null = running. */
export interface LaborSession {
  id: string;
  work_order_id: string;
  staff_user_id: string;
  started_at: string;
  ended_at: string | null;
  duration_minutes: number | null;
  labor_cost?: number | null;
  ended_reason?: "paused" | "completed" | null;
}

export type TimingEventType =
  | "acknowledged"
  | "assigned"
  | "arrived"
  | "work_started"
  | "work_paused"
  | "work_resumed"
  | "work_completed"
  | "reopened";

/** A row of `work_order_events` (append-only timing record). */
export interface TimingEvent {
  id: string;
  event_type: TimingEventType;
  occurred_at: string;
  actor_user_id?: string | null;
  staff_user_id?: string | null;
}

/** A row of `operational_audit_events` as GET /work-orders/{id}/audit returns it. */
export interface AuditEvent {
  id: string;
  action: string;
  actor_id?: string | null;
  actor_name?: string | null;
  old_state?: Record<string, unknown> | null;
  new_state?: Record<string, unknown> | null;
  reason_code?: string | null;
  reason_note?: string | null;
  created_at: string;
}

export interface RepairCode {
  id: string;
  code_type: "problem" | "cause" | "resolution";
  code: string;
  label: string;
  engineering_category?: string | null;
}

/** An inventory part as GET /inventory/parts lists it. */
export interface InventoryPart {
  id: string;
  name: string;
  sku?: string | null;
  unit?: string | null;
  total_on_hand: number;
}

export interface PartStockLocation {
  location_id: string;
  quantity: number;
  engineering_part_locations?: { name?: string | null } | null;
}

/** A part chosen for completion. Inventory is only deducted by the server when the completion is accepted. */
export interface StagedPart {
  partId: string;
  name: string;
  unit?: string | null;
  locationId: string;
  locationName?: string | null;
  quantity: number;
  /** On-hand at that location when it was chosen — a hint only; the server re-checks stock. */
  available: number | null;
}

/** A recorded consumption row of GET /work-orders/{id}/parts. */
export interface ConsumedPartRow {
  id: string;
  quantity_delta: number;
  created_at?: string;
  engineering_parts?: { name?: string | null; unit?: string | null; sku?: string | null } | null;
  engineering_part_locations?: { name?: string | null } | null;
}

/* ── Actions ──────────────────────────────────────────────────────────────── */

export type RepairActionId =
  | "claim"
  | "acknowledge"
  | "arrive"
  | "startLabor"
  | "pauseLabor"
  | "hold"
  | "escalate"
  | "resumeWork"
  | "complete"
  | "diagnose"
  | "evidence"
  | "parts"
  | "note";

export type RepairBlock = "viewOnly" | "claimedElsewhere" | "closed" | null;

export interface RepairActions {
  can: Record<RepairActionId, boolean>;
  /** The one action the sticky bar leads with. */
  primary: "claim" | "start" | "resumeWork" | "complete" | null;
  /** Why most actions are missing, so the screen can say it instead of hiding them silently. */
  block: RepairBlock;
  isMine: boolean;
  /** Labor wording: "Start" the first time, "Resume" once a session has been recorded. */
  laborVerb: "start" | "resume";
}

export interface RepairActionContext {
  wo: Pick<WorkOrder, "status" | "assigned_to" | "acknowledged_at" | "arrived_at">;
  role: string | null | undefined;
  userId: string | null | undefined;
  sessions: readonly LaborSession[];
}

const NONE: Record<RepairActionId, boolean> = {
  claim: false,
  acknowledge: false,
  arrive: false,
  startLabor: false,
  pauseLabor: false,
  hold: false,
  escalate: false,
  resumeWork: false,
  complete: false,
  diagnose: false,
  evidence: false,
  parts: false,
  note: false,
};

/** Mirrors the guards in work_orders.py: engineer + gm act; an engineer only on their own or unassigned-open orders. */
export function deriveRepairActions({ wo, role, userId, sessions }: RepairActionContext): RepairActions {
  const isMine = wo.assigned_to != null && wo.assigned_to === userId;
  const isManager = role === "gm";
  const closed = wo.status === "completed" || wo.status === "cancelled";
  const hasSessions = sessions.length > 0;
  const laborVerb: RepairActions["laborVerb"] = hasSessions ? "resume" : "start";

  if (closed) return { can: { ...NONE }, primary: null, block: "closed", isMine, laborVerb };
  if (!canActOnWorkOrders(role)) {
    return { can: { ...NONE, note: true }, primary: null, block: "viewOnly", isMine, laborVerb };
  }

  const claimable = wo.status === "open" && !wo.assigned_to;
  const owner = isMine || isManager;
  if (!owner && !claimable) {
    return { can: { ...NONE, note: true }, primary: null, block: "claimedElsewhere", isMine, laborVerb };
  }

  const myRunning = sessions.some((s) => s.ended_at == null && s.staff_user_id === userId);
  const working = wo.status === "in_progress";
  const holdable = owner && canTransitionWorkOrder(wo.status, "on_hold");
  const escalatable = (owner || claimable) && wo.status !== "escalated" && canTransitionWorkOrder(wo.status, "escalated");
  const resumable = owner && (wo.status === "on_hold" || wo.status === "escalated");
  // POST labor/start also claims + starts an open order, so an open order that is mine (or unassigned) can start.
  const canStart = (working && owner && !myRunning) || (wo.status === "open" && (isMine || isManager));

  const can: Record<RepairActionId, boolean> = {
    claim: claimable,
    acknowledge: wo.status === "open" && isMine && !wo.acknowledged_at,
    arrive: working && owner && !wo.arrived_at,
    startLabor: canStart,
    pauseLabor: myRunning && owner,
    hold: holdable,
    escalate: escalatable,
    resumeWork: resumable,
    complete: working && owner,
    diagnose: owner && !claimable,
    evidence: owner || claimable,
    parts: working && owner,
    note: true,
  };

  // Claim and resume lead when they apply; an order in progress leads with Review Completion (labor has its own
  // toggle beside it), and an open order assigned to the viewer leads with Start Repair.
  let primary: RepairActions["primary"] = null;
  if (can.claim) primary = "claim";
  else if (can.resumeWork) primary = "resumeWork";
  else if (can.complete) primary = "complete";
  else if (wo.status === "open" && can.startLabor) primary = "start";

  return { can, primary, block: null, isMine, laborVerb };
}

/* ── Labor ────────────────────────────────────────────────────────────────── */

export interface LaborSummary {
  /** Minutes in sessions the server has closed. */
  recordedMinutes: number;
  /** The running session, if any (from the server, not a local flag). */
  active: LaborSession | null;
  /** True when the running session belongs to the viewer. */
  activeIsMine: boolean;
  /** The closed sessions plus the running one's elapsed time. Provisional while a session runs. */
  totalMinutes: number;
  activeSeconds: number;
}

/** Device clock minus server clock, estimated from a record the server just stamped; 0 when they agree closely. */
export function estimateClockSkewMs(serverIso: string | null | undefined, deviceNowMs: number): number {
  if (!serverIso) return 0;
  const server = new Date(serverIso).getTime();
  if (Number.isNaN(server)) return 0;
  const diff = deviceNowMs - server;
  return Math.abs(diff) > 90_000 ? diff : 0;
}

/**
 * Reads labor from the server's sessions only. Elapsed time for a running session is `now - started_at`
 * (corrected by the clock skew and never negative); paused time is never counted because a pause closes the session.
 */
export function summarizeLabor(
  sessions: readonly LaborSession[],
  viewerId: string | null | undefined,
  nowMs: number,
  skewMs = 0
): LaborSummary {
  let recorded = 0;
  let active: LaborSession | null = null;
  for (const session of sessions) {
    if (session.ended_at == null) {
      active = session;
      continue;
    }
    recorded += Number(session.duration_minutes ?? 0);
  }
  let activeSeconds = 0;
  if (active) {
    const started = new Date(active.started_at).getTime();
    if (!Number.isNaN(started)) activeSeconds = Math.max(0, Math.floor((nowMs - skewMs - started) / 1000));
  }
  return {
    recordedMinutes: Math.round(recorded * 100) / 100,
    active,
    activeIsMine: active != null && active.staff_user_id === viewerId,
    totalMinutes: Math.round((recorded + activeSeconds / 60) * 100) / 100,
    activeSeconds,
  };
}

/** 00:24:16 */
export function formatStopwatch(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return [hh, mm, ss].map((n) => String(n).padStart(2, "0")).join(":");
}

/* ── Timeline ─────────────────────────────────────────────────────────────── */

export type TimelineKind = "event" | "note" | "photo";

export interface TimelineItem {
  id: string;
  kind: TimelineKind;
  at: string;
  /** i18n key under workOrders.repair.timeline.* — absent for a technician's note. */
  labelKey: string | null;
  params?: Record<string, string>;
  text?: string | null;
  actorName?: string | null;
  /** The viewer wrote it. */
  mine?: boolean;
  /** Recorded by the system rather than typed by a person. */
  machine: boolean;
}

const TIMING_LABEL: Record<TimingEventType, string> = {
  acknowledged: "acknowledged",
  assigned: "assigned",
  arrived: "arrived",
  work_started: "laborStarted",
  work_paused: "laborPaused",
  work_resumed: "laborResumed",
  work_completed: "completed",
  reopened: "reopened",
};

function auditItem(event: AuditEvent): TimelineItem | null {
  const base = { id: `audit-${event.id}`, kind: "event" as const, at: event.created_at, machine: true, actorName: event.actor_name ?? null };
  const next = typeof event.new_state?.status === "string" ? (event.new_state.status as string) : null;
  const prev = typeof event.old_state?.status === "string" ? (event.old_state.status as string) : null;
  switch (event.action) {
    case "work_order.transitioned":
    case "work_order.transition_overridden":
      if (next === "on_hold") {
        return { ...base, labelKey: "held", params: { reason: event.reason_code ?? "" }, text: event.reason_note ?? null };
      }
      if (next === "escalated") return { ...base, labelKey: "escalated", text: event.reason_note ?? null };
      if (next === "cancelled") return { ...base, labelKey: "cancelled", text: event.reason_note ?? null };
      // Back to work from a hold or an escalation. A first claim (open → in progress) is already the "assigned" event.
      if (next === "in_progress" && (prev === "on_hold" || prev === "escalated")) {
        return { ...base, labelKey: "resumedWork", text: event.reason_note ?? null };
      }
      return null;
    case "work_order.diagnosis_updated":
      return { ...base, labelKey: "diagnosisSaved" };
    case "work_order.repair_verification_failed":
      return { ...base, labelKey: "verificationFailed", text: typeof event.new_state?.verification_notes === "string" ? (event.new_state.verification_notes as string) : null };
    default:
      return null;
  }
}

export interface TimelineSources {
  timing: readonly TimingEvent[];
  audit: readonly AuditEvent[];
  comments: readonly WorkOrderComment[];
  photos: readonly WorkOrderPhoto[];
  createdAt?: string | null;
  viewerId?: string | null;
}

/** Everything recorded about the order, oldest first. Nothing is inferred: each row is a server record. */
export function buildTimeline({ timing, audit, comments, photos, createdAt, viewerId }: TimelineSources): TimelineItem[] {
  const items: TimelineItem[] = [];
  if (createdAt) items.push({ id: "created", kind: "event", at: createdAt, labelKey: "created", machine: true });
  for (const event of timing) {
    items.push({
      id: `timing-${event.id}`,
      kind: "event",
      at: event.occurred_at,
      labelKey: TIMING_LABEL[event.event_type] ?? null,
      machine: true,
      mine: event.actor_user_id != null && event.actor_user_id === viewerId,
    });
  }
  for (const event of audit) {
    const item = auditItem(event);
    if (item) items.push(item);
  }
  for (const comment of comments) {
    if (!comment.created_at) continue;
    items.push({
      id: `note-${comment.id}`,
      kind: "note",
      at: comment.created_at,
      labelKey: null,
      text: comment.comment,
      machine: comment.is_system === true,
      mine: comment.user_id != null && comment.user_id === viewerId,
    });
  }
  for (const photo of photos) {
    if (!photo.created_at) continue;
    items.push({
      id: `photo-${photo.id}`,
      kind: "photo",
      at: photo.created_at,
      labelKey: "photoAttached",
      params: { type: photo.photo_type ?? "progress" },
      text: photo.caption ?? null,
      machine: true,
    });
  }
  return items.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

/* ── Parts ────────────────────────────────────────────────────────────────── */

export type PartIssue = "quantity" | "overStock" | "noLocation";

export function stagedPartIssue(part: StagedPart): PartIssue | null {
  if (!part.locationId) return "noLocation";
  if (!Number.isFinite(part.quantity) || part.quantity <= 0) return "quantity";
  if (part.available != null && part.quantity > part.available) return "overStock";
  return null;
}

/** Adds a part, or raises the quantity of the same part at the same location (never two rows for one stock line). */
export function stagePart(current: readonly StagedPart[], incoming: StagedPart): StagedPart[] {
  const index = current.findIndex((p) => p.partId === incoming.partId && p.locationId === incoming.locationId);
  if (index === -1) return [...current, incoming];
  const next = [...current];
  next[index] = { ...next[index], quantity: next[index].quantity + incoming.quantity };
  return next;
}

/* ── Completion ───────────────────────────────────────────────────────────── */

export interface CompletionDraft {
  problemCodeId: string | null;
  causeCodeId: string | null;
  resolutionCodeId: string | null;
  problemOtherText: string;
  causeOtherText: string;
  resolutionOtherText: string;
  notes: string;
  verification: VerificationResult | null;
  verificationNotes: string;
  /** Only meaningful when the order has a linked asset. */
  assetRestoration: "keep_unavailable" | "restore" | null;
  parts: StagedPart[];
  /** Historical free-text parts note; kept so older workflows and non-inventory items still have a place. */
  freeTextParts: string;
}

export function emptyCompletionDraft(wo?: Partial<WorkOrder>): CompletionDraft {
  return {
    problemCodeId: wo?.problem_code?.id ?? null,
    causeCodeId: wo?.cause_code?.id ?? null,
    resolutionCodeId: wo?.resolution_code?.id ?? null,
    problemOtherText: wo?.problem_other_text ?? "",
    causeOtherText: wo?.cause_other_text ?? "",
    resolutionOtherText: wo?.resolution_other_text ?? "",
    notes: "",
    verification: null,
    verificationNotes: "",
    assetRestoration: null,
    parts: [],
    freeTextParts: wo?.parts_used ?? "",
  };
}

export type CompletionField = "resolution" | "problemOther" | "causeOther" | "resolutionOther" | "verification" | "verificationNotes" | "parts";

export type CompletionErrors = Partial<Record<CompletionField, string>>;

/** Codes whose label starts with "other" need a description — the API rejects them otherwise (`startswith("other")`). */
export function isOtherCode(code: RepairCode | undefined | null): boolean {
  return code != null && code.code.startsWith("other");
}

export function validateCompletion(
  draft: CompletionDraft,
  codes: { problem?: RepairCode; cause?: RepairCode; resolution?: RepairCode }
): CompletionErrors {
  const errors: CompletionErrors = {};
  if (!draft.resolutionCodeId && !draft.resolutionOtherText.trim()) errors.resolution = "resolution";
  if (isOtherCode(codes.problem) && !draft.problemOtherText.trim()) errors.problemOther = "other";
  if (isOtherCode(codes.cause) && !draft.causeOtherText.trim()) errors.causeOther = "other";
  if (isOtherCode(codes.resolution) && !draft.resolutionOtherText.trim()) errors.resolutionOther = "other";
  if (!draft.verification) errors.verification = "verification";
  else if (draft.verification !== "passed" && !draft.verificationNotes.trim()) errors.verificationNotes = "notes";
  if (draft.parts.some((p) => stagedPartIssue(p) != null)) errors.parts = "parts";
  return errors;
}

export interface CompleteWorkOrderBody {
  notes?: string;
  parts_used?: string;
  parts_consumed?: { part_id: string; location_id: string; quantity: number }[];
  problem_code_id?: string;
  cause_code_id?: string;
  resolution_code_id?: string;
  problem_other_text?: string;
  cause_other_text?: string;
  resolution_other_text?: string;
  verification_result?: VerificationResult;
  verification_notes?: string;
  asset_restoration?: "keep_unavailable" | "restore";
}

/** The exact body POST /work-orders/{id}/complete takes. Empty fields are left out, never sent as "". */
export function buildCompletionBody(draft: CompletionDraft, opts: { hasAsset: boolean }): CompleteWorkOrderBody {
  const text = (value: string) => value.trim() || undefined;
  const body: CompleteWorkOrderBody = {
    notes: text(draft.notes),
    parts_used: text(draft.freeTextParts),
    problem_code_id: draft.problemCodeId ?? undefined,
    cause_code_id: draft.causeCodeId ?? undefined,
    resolution_code_id: draft.resolutionCodeId ?? undefined,
    problem_other_text: text(draft.problemOtherText),
    cause_other_text: text(draft.causeOtherText),
    resolution_other_text: text(draft.resolutionOtherText),
    verification_result: draft.verification ?? undefined,
    verification_notes: text(draft.verificationNotes),
    asset_restoration: opts.hasAsset ? draft.assetRestoration ?? undefined : undefined,
  };
  if (draft.parts.length > 0) {
    body.parts_consumed = draft.parts.map((p) => ({ part_id: p.partId, location_id: p.locationId, quantity: p.quantity }));
  }
  return Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) as CompleteWorkOrderBody;
}

export type CompletionOutcome =
  | { kind: "completed"; followUpRequired: boolean }
  /** The server recorded a failed test and kept the order in progress. Not a success, not an error. */
  | { kind: "verification_failed" }
  /** Saved on this phone, not sent. */
  | { kind: "queued" }
  | { kind: "conflict"; message: string }
  | { kind: "rejected"; message: string; errors: CompletionErrors }
  | { kind: "failed"; message: string };

/** What a failed POST /complete means. Only a 409 for a failed verification is the "recorded, still in progress" outcome. */
export function interpretCompletionError(error: unknown, draft: Pick<CompletionDraft, "verification">): CompletionOutcome {
  const status = (error as { status?: number } | null)?.status;
  const message = error instanceof Error ? error.message : "";
  if (status === 409 && draft.verification === "failed" && /verification failed/i.test(message)) {
    return { kind: "verification_failed" };
  }
  if (status === 409) return { kind: "conflict", message };
  if (status === 422) {
    const errors: CompletionErrors = {};
    if (/describe the selected other problem/i.test(message)) errors.problemOther = "other";
    if (/describe the selected other cause/i.test(message)) errors.causeOther = "other";
    if (/describe the selected other resolution/i.test(message)) errors.resolutionOther = "other";
    if (/insufficient|not enough|stock/i.test(message)) errors.parts = "stock";
    return { kind: "rejected", message, errors };
  }
  return { kind: "failed", message };
}

/**
 * Offline completion rules. A completion made offline is only queued and replayed later, with no stock check and no
 * retry protection for inventory, so anything that moves inventory or records a failed test needs a connection.
 */
export type OfflineCompletionBlock = "parts" | "failedVerification" | null;

export function offlineCompletionBlock(draft: Pick<CompletionDraft, "parts" | "verification">): OfflineCompletionBlock {
  if (draft.verification === "failed") return "failedVerification";
  if (draft.parts.length > 0) return "parts";
  return null;
}
