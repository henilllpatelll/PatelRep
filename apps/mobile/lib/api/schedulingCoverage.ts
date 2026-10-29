import { api } from "./client";
import { classifyWriteFailure, type WriteFailure } from "./schedulingManage";

/* ─── Call-outs and shift coverage (Team Scheduling Phase 4) ─────────────────
   Every function here is a real server call; nothing is held locally, so a screen can only show "covered" after the
   server answered with a gap whose status is `filled`.

   Safety rules the callers rely on
     - An OFFER is not a shift: `createOffer` schedules nobody and the server reports `delivered: false` (there is no
       employee notification channel yet). Only `assignGap`, an accepted offer or an approved claim fills a gap.
     - `expectedVersion` travels with every write; a 409 `version_conflict` means someone else changed the gap.
     - `recordAbsence` carries an idempotency key, so a retry after a lost answer returns the SAME record.
     - `availability` is what the person SUBMITTED (available / outside / unavailable) and stays "unknown" when nothing was
       submitted: nobody is "available" merely for having no shift. Approved time off arrives as the blocker `approved_time_off`. */

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
function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export type GapStatus = "open" | "offered" | "filled" | "waived";
export type AbsenceKind = "called_out" | "unavailable" | "leaving_early" | "emergency" | "other";
export const ABSENCE_KINDS: readonly AbsenceKind[] = ["called_out", "unavailable", "leaving_early", "emergency", "other"];

export interface CoverageOffer {
  id: string;
  userId: string;
  userName: string;
  /** pending | accepted | declined | withdrawn | expired | superseded (a lapsed pending offer already reads `expired`). */
  status: string;
  expiresAt: string | null;
  /** Always "not_sent" today: no notification channel exists, so no offer is ever claimed to have been delivered. */
  delivery: string;
}

export interface CoverageClaim {
  id: string;
  userId: string;
  userName: string;
  status: string;
}

export interface CoverageGap {
  id: string;
  source: "absence" | "open_shift";
  absenceId: string | null;
  originalAssignmentId: string | null;
  departmentId: string | null;
  shiftId: string | null;
  shiftName: string;
  /** Hotel-local day (YYYY-MM-DD). */
  workDate: string;
  startTime: string | null;
  endTime: string | null;
  startsAt: string;
  endsAt: string;
  requiredRole: string | null;
  status: GapStatus;
  claimable: boolean;
  resolution: string | null;
  resolutionReason: string | null;
  filledUserId: string | null;
  filledUserName: string | null;
  notes: string | null;
  version: number;
  pendingOffers: number;
  pendingClaims: number;
  offers: CoverageOffer[];
  claims: CoverageClaim[];
  absentUserId: string | null;
  absentUserName: string | null;
  absenceKind: AbsenceKind | null;
}

export function parseOffer(raw: unknown): CoverageOffer | null {
  const row = rec(raw);
  const id = row ? str(row.id) : null;
  const userId = row ? str(row.user_id) : null;
  if (!row || !id || !userId) return null;
  return { id, userId, userName: str(row.user_name) ?? "", status: str(row.status) ?? "pending", expiresAt: str(row.expires_at), delivery: str(row.delivery) ?? "not_sent" };
}

function parseClaim(raw: unknown): CoverageClaim | null {
  const row = rec(raw);
  const id = row ? str(row.id) : null;
  const userId = row ? str(row.user_id) : null;
  if (!row || !id || !userId) return null;
  return { id, userId, userName: str(row.user_name) ?? "", status: str(row.status) ?? "pending" };
}

const GAP_STATUSES: readonly string[] = ["open", "offered", "filled", "waived"];

export function parseGap(raw: unknown): CoverageGap | null {
  const row = rec(raw);
  const id = row ? str(row.id) : null;
  const workDate = row ? str(row.work_date) : null;
  const startsAt = row ? str(row.starts_at) : null;
  const endsAt = row ? str(row.ends_at) : null;
  const status = row ? str(row.status) : null;
  if (!row || !id || !workDate || !startsAt || !endsAt || !status || !GAP_STATUSES.includes(status)) return null;
  const kind = str(row.absence_kind);
  return {
    id,
    source: row.source === "open_shift" ? "open_shift" : "absence",
    absenceId: str(row.absence_id),
    originalAssignmentId: str(row.original_assignment_id),
    departmentId: str(row.department_id),
    shiftId: str(row.shift_id),
    shiftName: str(row.shift_name) ?? "",
    workDate: workDate.slice(0, 10),
    startTime: str(row.start_time),
    endTime: str(row.end_time),
    startsAt,
    endsAt,
    requiredRole: str(row.required_role),
    status: status as GapStatus,
    claimable: row.claimable === true,
    resolution: str(row.resolution),
    resolutionReason: str(row.resolution_reason),
    filledUserId: str(row.filled_user_id),
    filledUserName: str(row.filled_user_name),
    notes: str(row.notes),
    version: num(row.version) ?? 1,
    pendingOffers: num(row.pending_offer_count) ?? 0,
    pendingClaims: num(row.pending_claim_count) ?? 0,
    offers: (Array.isArray(row.offers) ? row.offers : []).map(parseOffer).filter((o): o is CoverageOffer => o !== null),
    claims: (Array.isArray(row.claims) ? row.claims : []).map(parseClaim).filter((c): c is CoverageClaim => c !== null),
    absentUserId: str(row.absent_user_id),
    absentUserName: str(row.absent_user_name),
    absenceKind: kind && (ABSENCE_KINDS as readonly string[]).includes(kind) ? (kind as AbsenceKind) : null,
  };
}

export interface CoverageImpact {
  /** false = the workload could not be read; every number below is then null (never a guess). */
  verified: boolean;
  roomsAssigned: number | null;
  roomsDone: number | null;
  roomsInProgress: number | null;
  roomsRemaining: number | null;
  estimatedMinutesRemaining: number | null;
  minutesLeftInShift: number | null;
}

export function parseImpact(raw: unknown): CoverageImpact | null {
  const row = rec(raw);
  if (!row) return null;
  const verified = row.verified === true;
  return {
    verified,
    roomsAssigned: verified ? num(row.rooms_assigned) : null,
    roomsDone: verified ? num(row.rooms_done) : null,
    roomsInProgress: verified ? num(row.rooms_in_progress) : null,
    roomsRemaining: verified ? num(row.rooms_remaining) : null,
    estimatedMinutesRemaining: verified ? num(row.estimated_minutes_remaining) : null,
    minutesLeftInShift: num(row.minutes_left_in_shift),
  };
}

export interface CandidateShift {
  workDate: string;
  shiftName: string | null;
  startTime: string | null;
  endTime: string | null;
}

export type CandidateAvailability = "available" | "outside" | "unavailable" | "unknown";

export interface CoverageCandidate {
  userId: string;
  name: string;
  roles: string[];
  eligible: boolean;
  /** Why the person cannot take it (overlapping_shift, other_department, role_mismatch, is_absent_employee, …). */
  blockers: string[];
  /** What a supervisor should weigh (insufficient_rest, pending_offer_elsewhere, availability_unknown, …). */
  warnings: string[];
  reasons: string[];
  existingShifts: CandidateShift[];
  availability: CandidateAvailability;
}

export function parseCandidate(raw: unknown): CoverageCandidate | null {
  const row = rec(raw);
  const userId = row ? str(row.user_id) : null;
  if (!row || !userId) return null;
  return {
    userId,
    name: str(row.name) ?? "",
    roles: strings(row.roles),
    eligible: row.eligible === true,
    blockers: strings(row.blockers),
    warnings: strings(row.warnings),
    reasons: strings(row.reasons),
    existingShifts: (Array.isArray(row.existing_shifts) ? row.existing_shifts : []).flatMap((item) => {
      const s = rec(item);
      const workDate = s ? str(s.work_date) : null;
      return s && workDate ? [{ workDate, shiftName: str(s.shift_name), startTime: str(s.start_time), endTime: str(s.end_time) }] : [];
    }),
    availability: row.availability === "available" || row.availability === "outside" || row.availability === "unavailable" ? row.availability : "unknown",
  };
}

function newKey(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/* ─── Reads ───────────────────────────────────────────────────────────────── */

export async function fetchGaps(options: { status?: GapStatus; claimable?: boolean; dateFrom?: string } = {}): Promise<CoverageGap[]> {
  const query = [
    options.status ? `status=${options.status}` : "",
    options.claimable !== undefined ? `claimable=${options.claimable}` : "",
    options.dateFrom ? `date_from=${options.dateFrom}` : "",
  ].filter(Boolean).join("&");
  const body = rec(await api.get<unknown>(`/schedules/gaps${query ? `?${query}` : ""}`));
  if (!body || !Array.isArray(body.data)) throw new Error("Coverage response was not in the expected shape.");
  return body.data.map(parseGap).filter((gap): gap is CoverageGap => gap !== null);
}

function oneGap(body: unknown): CoverageGap {
  const root = rec(body);
  const gap = root ? parseGap(root.data) : null;
  if (!gap) throw new Error("Coverage response was not in the expected shape.");
  return gap;
}

export async function fetchGap(id: string): Promise<CoverageGap> {
  return oneGap(await api.get<unknown>(`/schedules/gaps/${encodeURIComponent(id)}`));
}

export interface CandidateList {
  candidates: CoverageCandidate[];
  gapVersion: number;
  eligibleCount: number;
}

export async function fetchCandidates(gapId: string, options: { q?: string; filter?: "all" | "eligible" | "warnings" | "conflicts" } = {}): Promise<CandidateList> {
  const params = [options.q?.trim() ? `q=${encodeURIComponent(options.q.trim())}` : "", options.filter && options.filter !== "all" ? `filter=${options.filter}` : ""].filter(Boolean).join("&");
  const body = rec(await api.get<unknown>(`/schedules/gaps/${encodeURIComponent(gapId)}/candidates${params ? `?${params}` : ""}`));
  const meta = body ? rec(body.meta) : null;
  if (!body || !Array.isArray(body.data) || !meta) throw new Error("Candidate response was not in the expected shape.");
  return {
    candidates: body.data.map(parseCandidate).filter((c): c is CoverageCandidate => c !== null),
    gapVersion: num(meta.gap_version) ?? 1,
    eligibleCount: num(meta.eligible) ?? 0,
  };
}

export interface HistoryEvent {
  id: string;
  resourceType: string;
  action: string;
  at: string | null;
  actorName: string | null;
  actorRole: string | null;
  reason: string | null;
}

export async function fetchHistory(gapId: string): Promise<HistoryEvent[]> {
  const body = rec(await api.get<unknown>(`/schedules/gaps/${encodeURIComponent(gapId)}/history`));
  if (!body || !Array.isArray(body.data)) throw new Error("History response was not in the expected shape.");
  return body.data.flatMap((item, index) => {
    const row = rec(item);
    const action = row ? str(row.action) : null;
    return row && action ? [{ id: str(row.id) ?? `e${index}`, resourceType: str(row.resource_type) ?? "", action, at: str(row.at), actorName: str(row.actor_name), actorRole: str(row.actor_role), reason: str(row.reason) }] : [];
  });
}

/* ─── Writes ──────────────────────────────────────────────────────────────── */

export interface RecordedCallOut {
  absenceId: string;
  gap: CoverageGap | null;
  impact: CoverageImpact | null;
  /** The server recognised a retry and returned the call-out it had already recorded. */
  replayed: boolean;
}

export interface CallOutInput {
  assignmentId: string;
  /** The shift's version the supervisor was looking at. */
  expectedVersion: number;
  kind: AbsenceKind;
  leavingAt?: string | null;
  note?: string | null;
  /** Reuse the same key when retrying one submission. */
  idempotencyKey: string;
}

export function newCallOutKey(): string {
  return newKey("callout");
}

export async function recordAbsence(input: CallOutInput): Promise<RecordedCallOut> {
  const body: Raw = { assignment_id: input.assignmentId, expected_version: input.expectedVersion, kind: input.kind, idempotency_key: input.idempotencyKey };
  if (input.kind === "leaving_early" && input.leavingAt) body.leaving_at = input.leavingAt;
  if (input.note?.trim()) body.note = input.note.trim();
  const root = rec(await api.post<unknown>("/schedules/absences", body));
  const data = root ? rec(root.data) : null;
  const absence = data ? rec(data.absence) : null;
  const absenceId = absence ? str(absence.id) : null;
  if (!data || !absenceId) throw new Error("Call-out response was not in the expected shape.");
  return { absenceId, gap: parseGap(data.gap), impact: parseImpact(data.impact), replayed: data.replayed === true };
}

export async function withdrawAbsence(absenceId: string, expectedVersion: number, reason: string): Promise<void> {
  await api.post<unknown>(`/schedules/absences/${encodeURIComponent(absenceId)}/withdraw`, { expected_version: expectedVersion, reason });
}

export interface OfferResult {
  gap: CoverageGap;
  /** False today: the server has no way to tell the employee, and says so. */
  delivered: boolean;
}

export async function createOffer(gapId: string, userId: string, expectedVersion: number): Promise<OfferResult> {
  const root = rec(await api.post<unknown>(`/schedules/gaps/${encodeURIComponent(gapId)}/offers`, { user_id: userId, expected_version: expectedVersion }));
  const meta = root ? rec(root.meta) : null;
  return { gap: oneGap(root), delivered: meta?.delivered === true };
}

export async function withdrawOffer(gapId: string, offerId: string): Promise<CoverageGap> {
  return oneGap(await api.post<unknown>(`/schedules/gaps/${encodeURIComponent(gapId)}/offers/${encodeURIComponent(offerId)}/withdraw`, {}));
}

/** The supervisor records that the offered employee said yes (phone or in person); the server fills the gap atomically. */
export async function recordOfferAccepted(offerId: string): Promise<void> {
  await api.post<unknown>(`/schedules/offers/${encodeURIComponent(offerId)}/respond`, { accept: true });
}

export async function assignGap(gapId: string, userId: string, expectedVersion: number, acknowledgeWarnings: boolean): Promise<CoverageGap> {
  return oneGap(await api.post<unknown>(`/schedules/gaps/${encodeURIComponent(gapId)}/assign`, { user_id: userId, expected_version: expectedVersion, acknowledge_warnings: acknowledgeWarnings }));
}

export async function waiveGap(gapId: string, expectedVersion: number, reason: string): Promise<CoverageGap> {
  return oneGap(await api.post<unknown>(`/schedules/gaps/${encodeURIComponent(gapId)}/waive`, { expected_version: expectedVersion, reason }));
}

export async function postOpenShift(input: { shiftId: string; workDate: string; claimable: boolean; requiredRole?: string | null; idempotencyKey: string }): Promise<CoverageGap> {
  const body: Raw = { shift_id: input.shiftId, work_date: input.workDate, claimable: input.claimable, idempotency_key: input.idempotencyKey };
  if (input.requiredRole) body.required_role = input.requiredRole;
  return oneGap(await api.post<unknown>("/schedules/open-shifts", body));
}

export function newOpenShiftKey(): string {
  return newKey("open");
}

export async function approveClaim(claimId: string, gapVersion: number, acknowledgeWarnings: boolean): Promise<CoverageGap> {
  return oneGap(await api.post<unknown>(`/schedules/claims/${encodeURIComponent(claimId)}/approve`, { expected_version: gapVersion, acknowledge_warnings: acknowledgeWarnings }));
}

export async function declineClaim(claimId: string, gapVersion: number, reason?: string): Promise<CoverageGap> {
  return oneGap(await api.post<unknown>(`/schedules/claims/${encodeURIComponent(claimId)}/decline`, { expected_version: gapVersion, ...(reason ? { reason } : {}) }));
}

/* ─── Failures ────────────────────────────────────────────────────────────── */

export interface CoverageFailure {
  /** i18n key suffix under `teamSchedule.coverage.failure.` */
  key: string;
  /** The change did not land because the gap or shift moved under the supervisor: reload and look again. */
  stale: boolean;
  /** No answer arrived, so the write MAY have landed: verify before retrying. */
  unconfirmed: boolean;
  raw: WriteFailure;
}

const KNOWN_CODES = new Set([
  "version_conflict", "gap_not_fillable", "gap_filled", "gap_waived", "gap_open", "gap_offered", "shift_ended", "candidate_ineligible", "warnings_need_acknowledgement",
  "duplicate_offer", "duplicate_absence", "schedule_conflict", "claim_stale", "claim_not_pending", "offer_expired", "offer_not_pending", "department_forbidden",
  "employee_inactive", "shift_cancelled", "leaving_outside_shift", "leaving_at_required", "already_covered", "assignment_not_found", "gap_not_found",
  "duplicate_open_shift", "historical_date", "staff_not_found", "offer_not_withdrawable", "gap_not_waivable", "shift_inactive", "coverage_unavailable", "approved_time_off",
]);
const STALE_CODES = new Set(["version_conflict", "gap_not_fillable", "gap_filled", "gap_waived", "claim_stale", "claim_not_pending", "offer_not_pending", "offer_expired", "offer_not_withdrawable", "gap_not_waivable", "candidate_ineligible", "schedule_conflict"]);

export function classifyCoverageFailure(error: unknown): CoverageFailure {
  const raw = classifyWriteFailure(error);
  const unconfirmed = raw.kind === "unconfirmed" || raw.kind === "signed_out";
  if (raw.kind === "signed_out") return { key: "signed_out", stale: false, unconfirmed, raw };
  if (raw.kind === "unconfirmed") return { key: "unconfirmed", stale: false, unconfirmed, raw };
  const code = raw.code ?? "";
  if (KNOWN_CODES.has(code)) return { key: code, stale: STALE_CODES.has(code), unconfirmed: false, raw };
  if (raw.kind === "forbidden") return { key: "forbidden", stale: false, unconfirmed: false, raw };
  if (raw.kind === "not_found") return { key: "gap_not_found", stale: true, unconfirmed: false, raw };
  return { key: "other", stale: false, unconfirmed: false, raw };
}
