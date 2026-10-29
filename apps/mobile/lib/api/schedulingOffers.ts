import { api } from "./client";

/* ─── What an employee sees of coverage (Team Scheduling Phase 7) ───────────
   Offers, open shifts and the employee's own requests. The server shows an employee only THEIR OWN offers and requests and the
   shift they are about (name, date, times, role): never the called-out person, other candidates or anyone else's claim.

   - An OFFER is a request to take a shift. It is not on the employee's schedule until they accept AND the server confirms
     (`respondToOffer` resolves with the accepted offer; nothing is shown as scheduled before that).
   - A CLAIM is interest in an open shift. A supervisor decides it; `pending` is never a shift. */

type Raw = Record<string, unknown>;

function rec(value: unknown): Raw | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Raw) : null;
}
function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export interface OfferedShift {
  id: string;
  name: string | null;
  workDate: string;
  startTime: string | null;
  endTime: string | null;
  startsAt: string;
  endsAt: string;
  requiredRole: string | null;
}

export type OfferStatus = "pending" | "accepted" | "declined" | "withdrawn" | "expired" | "superseded";
export type ClaimStatus = "pending" | "approved" | "declined" | "withdrawn";

export interface MyOffer {
  id: string;
  status: OfferStatus;
  expiresAt: string | null;
  shift: OfferedShift;
}

export interface MyClaim {
  id: string;
  status: ClaimStatus;
  shift: OfferedShift;
}

export interface OpenShift {
  shift: OfferedShift;
  /** The server's verdict right now (department, schedule, approved leave...). The claim re-checks it. */
  canClaim: boolean;
  blockers: string[];
  myClaimId: string | null;
}

export function parseShift(raw: unknown): OfferedShift | null {
  const row = rec(raw);
  const id = row ? str(row.id) : null;
  const workDate = row ? str(row.work_date) : null;
  const startsAt = row ? str(row.starts_at) : null;
  const endsAt = row ? str(row.ends_at) : null;
  if (!row || !id || !workDate || !startsAt || !endsAt) return null;
  return { id, name: str(row.shift_name), workDate: workDate.slice(0, 10), startTime: str(row.start_time), endTime: str(row.end_time), startsAt, endsAt, requiredRole: str(row.required_role) };
}

const OFFER_STATUSES: readonly string[] = ["pending", "accepted", "declined", "withdrawn", "expired", "superseded"];
const CLAIM_STATUSES: readonly string[] = ["pending", "approved", "declined", "withdrawn"];

export function parseOffer(raw: unknown): MyOffer | null {
  const row = rec(raw);
  const id = row ? str(row.id) : null;
  const status = row ? str(row.status) : null;
  const shift = row ? parseShift(row.shift) : null;
  if (!row || !id || !shift || !status || !OFFER_STATUSES.includes(status)) return null;
  return { id, status: status as OfferStatus, expiresAt: str(row.expires_at), shift };
}

export function parseClaim(raw: unknown): MyClaim | null {
  const row = rec(raw);
  const id = row ? str(row.id) : null;
  const status = row ? str(row.status) : null;
  const shift = row ? parseShift(row.shift) : null;
  if (!row || !id || !shift || !status || !CLAIM_STATUSES.includes(status)) return null;
  return { id, status: status as ClaimStatus, shift };
}

export function parseOpenShift(raw: unknown): OpenShift | null {
  const row = rec(raw);
  const shift = row ? parseShift(row.shift) : null;
  if (!row || !shift) return null;
  return { shift, canClaim: row.can_claim === true, blockers: list(row.blockers).filter((b): b is string => typeof b === "string"), myClaimId: str(row.my_claim_id) };
}

function rows<T>(body: unknown, parse: (raw: unknown) => T | null): T[] {
  return list(rec(body)?.data).map(parse).filter((item): item is T => item !== null);
}

export async function fetchMyOffers(): Promise<MyOffer[]> {
  return rows(await api.get<unknown>("/schedules/me/offers?history=true"), parseOffer);
}

export async function respondToOffer(offerId: string, accept: boolean): Promise<void> {
  const data = rec(rec(await api.post<unknown>(`/schedules/offers/${encodeURIComponent(offerId)}/respond`, { accept }))?.data);
  if (!data) throw new Error("Offer response was not in the expected shape.");
}

export async function fetchOpenShifts(): Promise<OpenShift[]> {
  return rows(await api.get<unknown>("/schedules/me/open-shifts"), parseOpenShift);
}

export async function claimOpenShift(gapId: string): Promise<void> {
  const data = rec(rec(await api.post<unknown>(`/schedules/gaps/${encodeURIComponent(gapId)}/claims`, {}))?.data);
  if (!data) throw new Error("Claim response was not in the expected shape.");
}

export async function fetchMyClaims(): Promise<MyClaim[]> {
  return rows(await api.get<unknown>("/schedules/me/claims"), parseClaim);
}

export async function withdrawClaim(claimId: string): Promise<void> {
  const data = rec(rec(await api.post<unknown>(`/schedules/claims/${encodeURIComponent(claimId)}/withdraw`, {}))?.data);
  if (!data) throw new Error("Claim response was not in the expected shape.");
}
