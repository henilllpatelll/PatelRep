import { api } from "@/lib/api/client";
import { toCopilotFailure } from "@/lib/ai/contract";
import { onAssistantSessionReset } from "@/lib/ai/session";
import type { CopilotSourceKey, SupervisorCopilotModel } from "@/lib/ai/supervisorCopilot";
import type { SupervisorAttentionItem } from "@/lib/housekeeping/supervisorAttention";
import type { SupervisorToday } from "@/lib/housekeeping/supervisorToday";

/* ─── Supervisor AI wording — the only paid call the supervisor Copilot makes ─
   Everything the supervisor sees on the Copilot (overview, observations, suggestions) is built on the phone
   from the verified Today snapshot (supervisorCopilot.ts). This module is the OPTIONAL paid layer on top: it
   sends those same figures (counts, room numbers, enum kinds — no names, notes, guest data or ids) and gets
   back plain wording. Hard rules, all enforced here and tested:

   - Never automatic. A request starts only from `requestSupervisorSummary`, which only a tap calls: not a
     render, a realtime event, a tab switch, a notification, an offline→online change or a screen opening.
   - One request at a time per person+purpose (a second tap joins the first), and an identical question
     (same figures) is answered from the stored result instead of spending another credit.
   - A forced refresh is spaced by a local cooldown; the server enforces its own on top.
   - Held in memory only, keyed by person + hotel; a sign-out or account switch empties it.
   - The wording is checked again on arrival: a multi-digit number that was not in the request means the
     model made it up and the text is dropped. Words never become facts, ids or actions. */

export type SummaryPurpose = "shift" | "handoff";

/** An answer is good for this long when the figures are unchanged. */
export const SUMMARY_TTL_MS = 45 * 60_000;
/** A forced refresh (or a retry after a failure) waits at least this long since the last attempt. */
export const SUMMARY_COOLDOWN_MS = 30_000;
export const SUMMARY_PATH = "/ai/supervisor/today-summary";

export interface SummaryRequestBody {
  purpose: SummaryPurpose;
  language: "en" | "es";
  readiness?: {
    in_service: number;
    ready: number;
    awaiting_inspection: number;
    in_progress: number;
    to_clean: number;
    out_of_order: number;
  };
  inspections?: { passed: number; failed: number; conditional: number };
  facts: Array<{ kind: string; count: number; rooms: string[] }>;
  unverified: CopilotSourceKey[];
}

const FACT_KINDS: ReadonlySet<string> = new Set([
  "arrival_at_risk",
  "readiness_risk",
  "task_blocker",
  "shift_ended_with_open_rooms",
  "workload_over_assigned",
  "unassigned_rooms",
  "awaiting_inspection",
  "access_restricted",
]);
const ROOM_NUMBER = /^[A-Za-z0-9-]{1,10}$/;
const MAX_ROOMS_PER_FACT = 8;
const MAX_COUNT = 1000;

function itemCount(item: SupervisorAttentionItem): number {
  const declared = item.explain.params.count;
  const count = typeof declared === "number" && Number.isFinite(declared) ? declared : Math.max(1, item.records.length);
  return Math.min(MAX_COUNT, Math.max(0, Math.floor(count)));
}

/**
 * The request for what is on screen, or null when the room board is unknown (nothing true to put into words).
 * Sources with no answer travel as `unverified`, never as zeros.
 */
export function buildSummaryRequest(
  today: SupervisorToday,
  model: SupervisorCopilotModel,
  purpose: SummaryPurpose,
  language: "en" | "es",
): SummaryRequestBody | null {
  if (!model.boardKnown) return null;
  const facts = new Map<string, { kind: string; count: number; rooms: string[] }>();
  for (const item of today.attention.items) {
    if (!FACT_KINDS.has(item.kind)) continue;
    const fact = facts.get(item.kind) ?? { kind: item.kind, count: 0, rooms: [] };
    fact.count = Math.min(MAX_COUNT, fact.count + itemCount(item));
    for (const record of item.records) {
      if (record.type !== "room" || !record.label || !ROOM_NUMBER.test(record.label)) continue;
      if (fact.rooms.length < MAX_ROOMS_PER_FACT && !fact.rooms.includes(record.label)) fact.rooms.push(record.label);
    }
    facts.set(item.kind, fact);
  }
  const body: SummaryRequestBody = {
    purpose,
    language,
    facts: [...facts.values()],
    unverified: [...model.unverified],
  };
  const readiness = today.readiness.value;
  if (readiness) {
    body.readiness = {
      in_service: readiness.inService,
      ready: readiness.ready,
      awaiting_inspection: readiness.awaitingInspection,
      in_progress: readiness.inProgress,
      to_clean: readiness.toClean,
      out_of_order: readiness.outOfOrder,
    };
  }
  const inspections = today.inspections.value;
  if (inspections) body.inspections = { passed: inspections.passed, failed: inspections.failed, conditional: inspections.conditional };
  return body;
}

/** Same figures → same fingerprint. Order of keys is fixed by `buildSummaryRequest`. */
export function summaryFingerprint(body: SummaryRequestBody): string {
  return JSON.stringify([body.purpose, body.language, body.readiness ?? null, body.inspections ?? null, body.facts, [...body.unverified].sort()]);
}

/* ─── Checking the words ──────────────────────────────────────────────────── */

const NUMBER = /\d+/g;

function allowedNumbers(body: SummaryRequestBody): Set<string> {
  const allowed = new Set<string>();
  const add = (value: unknown) => String(value).match(NUMBER)?.forEach((n) => allowed.add(n));
  Object.values(body.readiness ?? {}).forEach(add);
  Object.values(body.inspections ?? {}).forEach(add);
  for (const fact of body.facts) {
    add(fact.count);
    fact.rooms.forEach(add);
  }
  return allowed;
}

const MAX_CHARS: Record<SummaryPurpose, number> = { shift: 600, handoff: 900 };

/** The text if it is usable; null if it is empty, too long, or names a room/figure that was never in the request. */
export function acceptableSummary(text: unknown, body: SummaryRequestBody): string | null {
  if (typeof text !== "string") return null;
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.length > MAX_CHARS[body.purpose]) return null;
  const allowed = allowedNumbers(body);
  for (const number of cleaned.match(NUMBER) ?? []) {
    if (number.length >= 2 && !allowed.has(number)) return null;
  }
  return cleaned;
}

/* ─── Requesting ──────────────────────────────────────────────────────────── */

export type SummaryFailure =
  | "offline"
  | "disabled"
  | "credit_limit"
  | "rate_limited"
  | "unavailable"
  | "invalid"
  | "cooldown"
  | "no_data";

export interface SummaryResult {
  summary: string;
  /** Credits the server says this answer cost; null when it did not say. Never estimated here. */
  creditsUsed: number | null;
  generatedAt: number;
  fingerprint: string;
  purpose: SummaryPurpose;
}

export type SummaryOutcome =
  | { ok: true; result: SummaryResult; cached: boolean }
  | { ok: false; failure: SummaryFailure; retryAfterMs?: number };

type Post = (path: string, body: SummaryRequestBody) => Promise<unknown>;
const defaultPost: Post = (path, body) => api.post<unknown>(path, body);

const stored = new Map<string, SummaryResult>(); // `${scope}:${purpose}:${fingerprint}`
const latest = new Map<string, SummaryResult>(); // `${scope}:${purpose}` — the newest answer, whatever the figures were
const inFlight = new Map<string, Promise<SummaryOutcome>>(); // `${scope}:${purpose}`
const lastAttempt = new Map<string, number>(); // `${scope}:${purpose}`

// Bumped by every reset so an answer that was on its way for the previous person is dropped, not stored.
let epoch = 0;

export function resetSupervisorSummaries(): void {
  epoch += 1;
  stored.clear();
  latest.clear();
  inFlight.clear();
  lastAttempt.clear();
}

// A sign-out or account switch: the next person never sees, or inherits a cooldown from, the previous one.
onAssistantSessionReset(resetSupervisorSummaries);

/** The newest stored answer for this person, and whether it still matches the figures on screen. */
export function peekSupervisorSummary(
  scope: string | null,
  purpose: SummaryPurpose,
  fingerprint: string | null,
  now: number = Date.now(),
): { result: SummaryResult; current: boolean } | null {
  if (!scope) return null;
  const result = latest.get(`${scope}:${purpose}`);
  if (!result) return null;
  return { result, current: fingerprint !== null && result.fingerprint === fingerprint && now - result.generatedAt <= SUMMARY_TTL_MS };
}

export function isSummaryPending(scope: string | null, purpose: SummaryPurpose): boolean {
  return scope !== null && inFlight.has(`${scope}:${purpose}`);
}

function failureOf(error: unknown): SummaryFailure {
  const failure = toCopilotFailure(error);
  switch (failure.kind) {
    case "offline":
      return "offline";
    case "permission":
      return "disabled";
    case "credit_limit":
      return "credit_limit";
    case "rate_limited":
      return "rate_limited";
    default:
      // The server answers 502 when the wording could not be verified; every other server problem is "unavailable".
      return failure.status === 502 ? "invalid" : "unavailable";
  }
}

export interface RequestOptions {
  scope: string | null;
  body: SummaryRequestBody | null;
  online: boolean;
  /** Skip the stored answer for these exact figures (the person tapped Refresh). */
  force?: boolean;
  now?: number;
  post?: Post;
  /** Whether the signed-in person is still `scope` when the answer arrives. */
  stillCurrent?: () => boolean;
}

/**
 * Ask for the wording. This is the ONLY function that can spend a credit and only a deliberate tap calls it.
 * Resolves, never throws.
 */
export async function requestSupervisorSummary(options: RequestOptions): Promise<SummaryOutcome> {
  const { scope, body, online, force = false, post = defaultPost } = options;
  const now = options.now ?? Date.now();
  if (!scope || !body) return { ok: false, failure: "no_data" };

  const key = `${scope}:${body.purpose}`;
  const fingerprint = summaryFingerprint(body);

  const joined = inFlight.get(key);
  if (joined) return joined; // a second tap while the first is on its way is the same request

  const hit = stored.get(`${key}:${fingerprint}`);
  if (hit && !force && now - hit.generatedAt <= SUMMARY_TTL_MS) return { ok: true, result: hit, cached: true };

  if (!online) return { ok: false, failure: "offline" };

  const last = lastAttempt.get(key);
  if (last !== undefined && now - last >= 0 && now - last < SUMMARY_COOLDOWN_MS) {
    return { ok: false, failure: "cooldown", retryAfterMs: SUMMARY_COOLDOWN_MS - (now - last) };
  }
  lastAttempt.set(key, now);
  const startedIn = epoch;

  const run = (async (): Promise<SummaryOutcome> => {
    try {
      const raw = (await post(SUMMARY_PATH, body)) as { data?: { summary?: unknown; credits_used?: unknown } } | null;
      if (startedIn !== epoch || (options.stillCurrent && !options.stillCurrent())) return { ok: false, failure: "unavailable" };
      const summary = acceptableSummary(raw?.data?.summary, body);
      if (!summary) return { ok: false, failure: "invalid" };
      const credits = raw?.data?.credits_used;
      const result: SummaryResult = {
        summary,
        creditsUsed: typeof credits === "number" && Number.isFinite(credits) ? credits : null,
        generatedAt: now,
        fingerprint,
        purpose: body.purpose,
      };
      stored.set(`${key}:${fingerprint}`, result);
      latest.set(key, result);
      return { ok: true, result, cached: false };
    } catch (error) {
      return { ok: false, failure: failureOf(error) };
    } finally {
      if (startedIn === epoch) inFlight.delete(key);
    }
  })();
  inFlight.set(key, run);
  return run;
}
