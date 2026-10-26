import { api, ApiError } from "./client";

/* ─── Inspection API ────────────────────────────────────────────────────────
   Two pathways exist on the server:

   • POST /housekeeping/inspections            — legacy, JSON. The shipped Inspect screen still uses it.
   • POST /housekeeping/inspections/complete   — validated, multipart, idempotent. The redesigned workflow uses it
     (`completeInspection` below). The client mints `client_submission_id`; the server stores it AS the inspection's
     id, so resubmitting the same id can never record a second inspection.

   Everything here is a thin, typed wrapper. Rules and decisions live in lib/inspections/*. */

export interface InspectionTemplateItem {
  id: string;
  section: string;
  description: string;
  is_required: boolean;
  /** A failed result needs linked photo evidence. Absent on very old servers → treated as false. */
  requires_photo_on_fail?: boolean;
  /** Explicit per-item N/A policy. Absent on older servers → N/A allowed (the previous behaviour). */
  allows_na?: boolean;
  sort_order?: number;
}

export interface InspectionTemplate {
  id: string;
  name: string;
  /** null = applies to every room type. */
  room_type_id?: string | null;
  is_default?: boolean;
  is_active?: boolean;
  /** Opaque digest of the checklist. Echo it back on completion so a mid-inspection edit is detected by the server. */
  fingerprint?: string;
  items: InspectionTemplateItem[];
}

export async function listInspectionTemplates(): Promise<{ data: InspectionTemplate[] }> {
  return api.get<{ data: InspectionTemplate[] }>("/housekeeping/inspections/templates");
}

export interface InspectionItem {
  template_item_id: string;
  result: "pass" | "fail" | "na";
}

/** Legacy JSON submit — kept for the shipped screen. New work uses `completeInspection`. */
export async function submitInspection(payload: {
  room_id: string;
  template_id?: string;
  overall_result: "passed" | "failed" | "conditional";
  notes?: string;
  items?: InspectionItem[];
}): Promise<{ id: string }> {
  const res = await api.post<{ data: { id: string } }>("/housekeeping/inspections", {
    ...payload,
    items: payload.items ?? [],
  });
  return { id: res.data?.id ?? "" };
}

export type CorrectionKind = "touch_up" | "reclean";

/** What failed last time, for a room that is back in the queue to be re-checked. */
export interface PreviousFailure {
  inspection_id: string;
  inspected_at: string | null;
  overall_result: string;
  notes: string | null;
  correction_kind: CorrectionKind | null;
  items: { id: string | null; label: string; note: string | null }[];
}

/** A room waiting for inspection, as GET /housekeeping/ready-for-inspection returns it (this hotel only). */
export interface ReadyRoom {
  room_id: string;
  room_number: string;
  floor: number | null;
  cleaned_by: string;
  cleaned_at: string | null;
  housekeeper_id: string | null;
  clean_type: string | null;
  /** Which checklist applies. Absent on servers older than migration 223. */
  room_type_id?: string | null;
  /** That room type's own name, for display only. Absent on older servers; null when not recorded. */
  room_type_name?: string | null;
  /** Identifies this "cleaned, awaiting inspection" cycle; null when it cannot be determined (then not checked). */
  clean_cycle_id?: string | null;
  /** Set when this room is being re-checked after a failed inspection. */
  previous_failure?: PreviousFailure | null;
  /* Recorded operational facts the queue is ordered by (absent on servers that predate Phase 2). Never predictions. */
  building?: string | null;
  vip?: boolean;
  /** The recorded guest arrival (check-in) time. */
  arrival_at?: string | null;
  /** 1 (highest) .. 10; the schema default is 5. */
  priority?: number | null;
  priority_needed_by?: string | null;
}

/** `date` is the hotel's business date; the server uses it to find who was assigned to each room. */
export async function fetchReadyForInspection(date: string): Promise<ReadyRoom[]> {
  const res = await api.get<{ data: ReadyRoom[] | null }>(`/housekeeping/ready-for-inspection?date=${encodeURIComponent(date)}`);
  return res.data ?? [];
}

/** Strict read for the redesigned flow: a body that is not the documented list THROWS instead of reading as "nothing to inspect". */
export async function fetchReadyForInspectionVerified(date: string): Promise<ReadyRoom[]> {
  const res = await api.get<{ data?: unknown }>(`/housekeeping/ready-for-inspection?date=${encodeURIComponent(date)}`);
  if (!res || !Array.isArray(res.data)) throw new Error("Malformed inspection queue response");
  return res.data as ReadyRoom[];
}

/* ─── Validated completion ─────────────────────────────────────────────── */

export type ItemSeverity = "minor" | "major";

export interface CompletionItem {
  template_item_id: string;
  result: "pass" | "fail" | "na";
  note?: string;
  /** Only on failed items. Unset = not classified (the server treats it as major). */
  severity?: ItemSeverity;
}

/** The JSON half of the multipart request. Every field after `items` is a guard the server checks. */
export interface CompletionBody {
  room_id: string;
  template_id: string;
  overall_result: "passed" | "failed";
  notes?: string;
  items: CompletionItem[];
  client_submission_id: string;
  template_fingerprint?: string;
  expected_hotel_id?: string;
  expected_clean_cycle_id?: string;
  reinspection_of?: string;
}

export interface CompletionPhoto {
  itemId: string;
  uri: string;
}

/**
 * Send a completed checklist. Resolves with the raw body (parse it with `parseCompletionResponse`: a 200 with an
 * unexpected body is NOT a success). Rejects with `ApiError` when the server answered with an error, or a plain
 * `Error` when there was no answer at all — in which case the inspection MAY have been recorded.
 */
export async function completeInspection(body: CompletionBody, photos: readonly CompletionPhoto[] = []): Promise<unknown> {
  const form = new FormData();
  form.append("inspection", JSON.stringify(body));
  // The server pairs photo_item_ids[i] with photos[i], so they are appended in lock step. Every kept photo was
  // re-encoded as a JPEG by lib/inspections/evidence, so the type and name sent here are what the bytes really are.
  for (const photo of photos) {
    form.append("photo_item_ids", photo.itemId);
    form.append("photos", { uri: photo.uri, type: "image/jpeg", name: `${photo.itemId}.jpg` } as unknown as Blob);
  }
  return api.postForm<unknown>("/housekeeping/inspections/complete", form);
}

/* ─── Reads ─────────────────────────────────────────────────────────────── */

export type CorrectionStatus =
  | "correction_missing"
  | "unassigned"
  | "assigned"
  | "in_progress"
  | "escalated"
  | "resubmitted"
  | "verified"
  | "superseded"
  | "cancelled";

export interface InspectionDetailItem {
  template_item_id: string | null;
  section: string | null;
  description: string | null;
  is_required: boolean | null;
  requires_photo_on_fail: boolean | null;
  result: "pass" | "fail" | "na" | string;
  note: string | null;
  severity: ItemSeverity | null;
  /** A short-lived signed link (minutes), never a permanent address. Null when there is no photo OR it can't be opened. */
  photo_url: string | null;
  /** The record says a photo exists, whether or not a link could be made now. Absent on servers older than Phase 6. */
  has_evidence?: boolean;
}

export type CorrectionActivityType =
  | "inspection_failed"
  | "correction_created"
  | "reassigned"
  | "escalated"
  | "work_started"
  | "work_submitted"
  | "task_completed"
  | "reinspection_passed"
  | "reinspection_failed";

/** One recorded event. Only things the database timestamped appear; nothing is estimated. */
export interface CorrectionActivity {
  type: CorrectionActivityType | string;
  at: string;
  actor_name: string | null;
  /** Reassignments: who it was given to. */
  assignee_name?: string | null;
  /** The inspection this event belongs to. Absent on servers older than Phase 6. */
  inspection_id?: string | null;
}

export interface InspectionCorrection {
  status: CorrectionStatus;
  reinspection_id: string | null;
  kind: CorrectionKind | null;
  /** The room's own status now. Absent on servers older than Phase 5. */
  room_status?: string | null;
  task: {
    id: string;
    status: string;
    priority: string | null;
    assigned_to: string | null;
    assigned_name: string | null;
    due_at: string | null;
    created_at?: string | null;
    started_at: string | null;
    completed_at: string | null;
    escalated_at?: string | null;
  } | null;
  /** When the housekeeper last finished cleaning the room after the failure, if they did. */
  resubmission?: { at: string; housekeeper_id: string | null; housekeeper_name: string | null } | null;
  activity?: CorrectionActivity[];
}

export interface InspectionDetail {
  id: string;
  room_id: string;
  room_number: string | null;
  floor: number | null;
  /** Absent on servers older than Phase 6. */
  building?: string | null;
  room_type_id: string | null;
  template_id: string | null;
  template_name: string | null;
  /** `conditional` only appears on historical rows. */
  overall_result: "passed" | "failed" | "conditional" | string;
  notes: string | null;
  completed_at: string | null;
  inspected_by: string | null;
  inspector_name: string | null;
  /** Who last finished cleaning the room before this inspection (their own clean session). Absent when none was recorded. */
  housekeeper_id?: string | null;
  housekeeper_name?: string | null;
  /** STAY / DEP of that clean. */
  service_type?: string | null;
  correction_kind: CorrectionKind | null;
  reinspection_of: string | null;
  items: InspectionDetailItem[];
  correction: InspectionCorrection | null;
}

export async function fetchInspectionDetail(inspectionId: string): Promise<InspectionDetail> {
  const res = await api.get<{ data: InspectionDetail }>(`/housekeeping/inspections/${encodeURIComponent(inspectionId)}`);
  if (!res?.data || typeof res.data.id !== "string") throw new Error("Malformed inspection response");
  return res.data;
}

export type SubmissionReadBack = { status: "found"; detail: InspectionDetail } | { status: "not_found" };

/**
 * "Did my submission land?" The only authoritative answer after a lost response. `not_found` is definitive for
 * now (nothing recorded under that id by this person in this hotel); any other failure throws and leaves the
 * caller uncertain.
 */
export async function fetchInspectionSubmission(submissionId: string): Promise<SubmissionReadBack> {
  try {
    const res = await api.get<{ data: InspectionDetail }>(
      `/housekeeping/inspections/submissions/${encodeURIComponent(submissionId)}`,
    );
    if (!res?.data || typeof res.data.id !== "string") throw new Error("Malformed inspection response");
    return { status: "found", detail: res.data };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return { status: "not_found" };
    throw error;
  }
}

/* ─── Today's completed inspections and the hotel's open corrections ──────── */

/** One row of GET /housekeeping/inspections (today's records). Fields added in Phase 2 are optional for older servers. */
export interface InspectionRecordRow {
  id: string;
  room_id?: string | null;
  room_number: string;
  floor?: number | null;
  building?: string | null;
  /** Legacy: carries an id prefix when no name is on file. Never display it - use `inspector_display_name`. */
  inspector_name?: string | null;
  /** The real name, or null when none is recorded. */
  inspector_display_name?: string | null;
  overall_result: string;
  notes?: string | null;
  completed_at: string | null;
  reinspection_of?: string | null;
  correction_kind?: CorrectionKind | null;
}

/** Strict read: a body that is not the documented list THROWS instead of reading as "nothing was inspected". */
export async function fetchInspectionRecords(date: string): Promise<InspectionRecordRow[]> {
  const day = encodeURIComponent(date);
  const res = await api.get<{ data?: unknown }>(`/housekeeping/inspections?date_from=${day}&date_to=${day}`);
  if (!res || !Array.isArray(res.data)) throw new Error("Malformed inspections response");
  return res.data as InspectionRecordRow[];
}

/** A failed inspection whose correction is not settled, as GET /housekeeping/inspections/corrections returns it. */
export interface OpenCorrectionRow {
  inspection_id: string;
  room_id: string | null;
  room_number: string | null;
  floor: number | null;
  building: string | null;
  inspected_at: string | null;
  overall_result: string;
  kind: CorrectionKind | null;
  status: CorrectionStatus | string;
  /** The room's own status; a task can be done while the room is not CLEAN. Absent on older servers. */
  room_status?: string | null;
  notes: string | null;
  inspector_name: string | null;
  failed_count: number;
  failed_items: { id: string | null; label: string; note: string | null }[];
  task: {
    id: string | null;
    status: string | null;
    assigned_to: string | null;
    assigned_name: string | null;
    due_at: string | null;
    created_at?: string | null;
    started_at: string | null;
    completed_at: string | null;
    escalated_at?: string | null;
  } | null;
}

export interface OpenCorrections {
  rows: OpenCorrectionRow[];
  /** More corrections exist than were returned: the list is a lower bound. */
  truncated: boolean;
}

/** One bounded, tenant-scoped read for every unsettled correction - never a request per room. */
export async function fetchOpenCorrections(): Promise<OpenCorrections> {
  const res = await api.get<{ data?: unknown; meta?: { truncated?: unknown } }>("/housekeeping/inspections/corrections");
  if (!res || !Array.isArray(res.data)) throw new Error("Malformed corrections response");
  return { rows: res.data as OpenCorrectionRow[], truncated: res.meta?.truncated === true };
}

/* ─── Managing an open correction ───────────────────────────────────────── */

export interface CorrectionOwner {
  id: string;
  name: string;
  role: string | null;
}

/** Everyone in this hotel who may be given a correction. The server enforces the same list when assigning. */
export async function fetchCorrectionOwners(): Promise<CorrectionOwner[]> {
  const res = await api.get<{ data?: unknown }>("/housekeeping/inspections/correction-owners");
  if (!res || !Array.isArray(res.data)) throw new Error("Malformed correction owners response");
  return (res.data as CorrectionOwner[]).filter((owner) => owner && typeof owner.id === "string" && typeof owner.name === "string" && owner.name.trim());
}

export interface CorrectionChange {
  inspection_id: string;
  /** False when nothing needed changing (already owned by them / already escalated): a safe retry. */
  changed: boolean;
  task: { id: string; status: string; assigned_to: string | null; assigned_name?: string | null };
}

function parseChange(res: { data?: unknown } | null | undefined): CorrectionChange {
  const data = res?.data as Partial<CorrectionChange> | undefined;
  if (!data || typeof data.inspection_id !== "string" || typeof data.changed !== "boolean" || !data.task || typeof data.task.id !== "string") {
    throw new Error("Malformed correction response");
  }
  return data as CorrectionChange;
}

/**
 * Give the open correction to someone else. `expectedAssignedTo` is who the screen believed owned it (null = nobody): a
 * different current owner is refused (409 `correction_changed`) instead of being overwritten.
 */
export async function reassignCorrection(inspectionId: string, assignedTo: string, expectedAssignedTo: string | null): Promise<CorrectionChange> {
  return parseChange(
    await api.post<{ data?: unknown }>(`/housekeeping/inspections/${encodeURIComponent(inspectionId)}/correction/reassign`, {
      assigned_to: assignedTo,
      expected_assigned_to: expectedAssignedTo,
    }),
  );
}

export async function escalateCorrection(inspectionId: string, note?: string): Promise<CorrectionChange> {
  return parseChange(
    await api.post<{ data?: unknown }>(`/housekeeping/inspections/${encodeURIComponent(inspectionId)}/correction/escalate`, note?.trim() ? { note: note.trim() } : {}),
  );
}

/**
 * Ask the server to create the correction task a failed inspection is missing (safe to repeat: it finds the one that
 * exists). Refused with 409 `correction_closed` when a later inspection already settled the failure.
 */
export async function requestCorrectionAgain(inspectionId: string): Promise<{ created: boolean }> {
  const res = await api.post<{ data?: { created?: unknown; task?: { id?: unknown } } }>(`/housekeeping/inspections/${encodeURIComponent(inspectionId)}/reclean`, {});
  if (!res?.data?.task || typeof res.data.task.id !== "string") throw new Error("Malformed correction response");
  return { created: res.data.created === true };
}
