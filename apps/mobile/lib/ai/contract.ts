/* ─── The assistant's one response contract ─────────────────────────────────
   POST /ai/copilot/chat answers `{ data: { response_type, message, ... } }`. Every
   assistant surface (the corner card and the full-screen chat) reads that reply
   through `normalizeCopilotResponse`, never through its own guesses, so the two
   can never disagree about what a reply means.

   The adapter is deliberately strict. A reply it does not recognise, or one whose
   previews are unusable, becomes `unsupported` / an `invalid_response` failure —
   it is never shown as a successful action. Previews are drafts: nothing here
   creates anything; creating needs the person's explicit confirmation
   (lib/ai/copilotChat.confirmAction). */

import { ApiError } from "@/lib/api/client";
import { isValidEntityId } from "@/lib/ai/launch";
import {
  guestRequestDraftFromRaw,
  taskDraftFromRaw,
  workOrderDraftFromRaw,
  type ActionPreview,
} from "@/lib/ai/drafts";

export type { ActionPreview, ActionKind } from "@/lib/ai/drafts";

/** What the words in a message are made of: where a statement came from. */
export type Provenance =
  /** A fact read straight from the person's own data. */
  | "verified"
  /** Computed on-device or by a rule engine; no language model wrote it. */
  | "deterministic"
  /** Wording (or an interpretation) produced by a language model. */
  | "ai";

export interface AssistantSource {
  title: string;
  excerpt: string | null;
  page: number | null;
  documentId: string | null;
  /** The approved version of the cited document, only when the server read one from the document's own record. */
  version?: number | null;
  /** A section label, only when the indexed passage really carries one. Never inferred. */
  section?: string | null;
}

/** Why the assistant could not give a verified procedure answer. */
export const SOP_REASONS = ["no_documents", "no_match", "insufficient", "conflict", "unverified_figures"] as const;
export type SopReason = (typeof SOP_REASONS)[number];

/** An approved procedure worth opening when there is no verified answer. */
export interface RelatedDocument {
  id: string;
  title: string;
  category: string | null;
}

/** How a procedure answer stands. Present only for replies the SOP search produced. */
export interface SopAnswerMeta {
  /** True only when the answer rests on the sources listed with it. */
  grounded: boolean;
  reason: SopReason | null;
  /** Chemicals, hazards, emergencies or room entry: the original document must stay one tap away. */
  highRisk: boolean;
  answerLanguage: "en" | "es" | null;
  related: RelatedDocument[];
}

/** Intents a clarification option may point the assistant at. */
export const CLARIFY_INTENT_HINTS = ["task_creation", "work_order_creation", "guest_request_creation"] as const;
export type ClarifyIntentHint = (typeof CLARIFY_INTENT_HINTS)[number];

/** Every hint this app sends. The server whitelists hints and checks each against the person's real role. */
export type IntentHint = ClarifyIntentHint | "sop_query";

export interface ClarifyOption {
  label: string;
  intentHint: ClarifyIntentHint;
}

/** Facts the server looked up itself for the ids the client sent (never the client's own claims). */
export interface TrustedContext {
  roomId?: string;
  roomNumber?: string;
  taskId?: string;
  documentId?: string;
  /** The title and approved version the server found for the document id (shown instead of the launcher's label). */
  documentTitle?: string;
  documentVersion?: number;
}

interface OutcomeBase {
  message: string;
  intent: string | null;
  provenance: Provenance;
  trustedContext: TrustedContext | null;
}

export type CopilotOutcome =
  | (OutcomeBase & { kind: "answer"; sources: AssistantSource[]; sop?: SopAnswerMeta })
  | (OutcomeBase & { kind: "actions"; actions: ActionPreview[] })
  | (OutcomeBase & { kind: "clarify"; options: ClarifyOption[] })
  /** A well-formed reply for something this app cannot act on (e.g. a manager-only preview). */
  | (OutcomeBase & { kind: "unsupported" });

export type CopilotFailureKind =
  | "offline"
  | "permission"
  | "credit_limit"
  | "rate_limited"
  | "unavailable"
  | "not_found"
  | "invalid_request"
  | "invalid_response"
  | "unauthenticated"
  | "unconfirmed"
  | "unknown";

export class CopilotFailure extends Error {
  readonly kind: CopilotFailureKind;
  readonly status?: number;

  constructor(kind: CopilotFailureKind, message: string, status?: number) {
    super(message);
    this.name = "CopilotFailure";
    this.kind = kind;
    this.status = status;
  }
}

const NETWORK_RE = /network request failed|failed to fetch|network error|load failed|offline|internet/i;
const TIMEOUT_RE = /timed out|timeout/i;
const AUTH_RE = /not authenticated|session expired/i;

/** Classify anything a request can throw. Server detail is kept only where it is meant for people. */
export function toCopilotFailure(error: unknown): CopilotFailure {
  if (error instanceof CopilotFailure) return error;
  if (error instanceof ApiError) {
    const { status } = error;
    if (status === 402) return new CopilotFailure("credit_limit", error.message, status);
    if (status === 403) return new CopilotFailure("permission", error.message, status);
    if (status === 404) return new CopilotFailure("not_found", error.message, status);
    if (status === 401) return new CopilotFailure("unauthenticated", error.message, status);
    if (status === 429) return new CopilotFailure("rate_limited", error.message, status);
    if (status >= 500) return new CopilotFailure("unavailable", error.message, status);
    if (status === 400 || status === 409 || status === 422) return new CopilotFailure("invalid_request", error.message, status);
    return new CopilotFailure("unknown", error.message, status);
  }
  const message = error instanceof Error ? error.message : "";
  if (AUTH_RE.test(message)) return new CopilotFailure("unauthenticated", message);
  if (TIMEOUT_RE.test(message)) return new CopilotFailure("unavailable", message);
  if (NETWORK_RE.test(message) || error instanceof TypeError) return new CopilotFailure("offline", message);
  return new CopilotFailure("unknown", message);
}

/* ─── Normalising a reply ─────────────────────────────────────────────────── */

const MAX_ACTIONS = 20;
const MAX_SOURCES = 5;
const MAX_OPTIONS = 4;

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** No model wrote it when the server answered from its rule engine or from nothing at all. */
function provenanceFromModel(model: unknown): Provenance {
  return str(model) && model !== "rule_engine" ? "ai" : "deterministic";
}

function normalizeTrustedContext(raw: unknown): TrustedContext | null {
  const ctx = record(raw);
  if (!ctx) return null;
  const out: TrustedContext = {};
  if (str(ctx.room_id)) out.roomId = str(ctx.room_id)!;
  if (str(ctx.room_number)) out.roomNumber = str(ctx.room_number)!;
  if (str(ctx.task_id)) out.taskId = str(ctx.task_id)!;
  if (str(ctx.document_id)) out.documentId = str(ctx.document_id)!;
  if (str(ctx.document_title)) out.documentTitle = str(ctx.document_title)!.slice(0, 120);
  if (typeof ctx.document_version === "number" && Number.isFinite(ctx.document_version)) out.documentVersion = ctx.document_version;
  return Object.keys(out).length > 0 ? out : null;
}

function normalizeSources(raw: unknown): AssistantSource[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: AssistantSource[] = [];
  for (const item of raw) {
    const source = record(item);
    if (!source) continue;
    const meta = record(source.metadata) ?? {};
    const title = str(source.title) ?? str(meta.title) ?? "SOP";
    const pageValue = typeof source.page === "number" ? source.page : meta.page_number;
    const page = typeof pageValue === "number" && Number.isInteger(pageValue) && pageValue > 0 && pageValue <= 9999 ? pageValue : null;
    // A citation can only link to a document id that is shaped like one; anything else is shown as plain text.
    const rawId = str(source.document_id);
    const documentId = rawId && isValidEntityId(rawId) ? rawId.toLowerCase() : null;
    const key = `${documentId ?? title}:${page ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const excerpt = str(source.content);
    const version = typeof source.version === "number" && source.version > 0 ? source.version : null;
    out.push({ title, excerpt: excerpt ? excerpt.slice(0, 280) : null, page, documentId, version, section: str(source.section)?.slice(0, 120) ?? null });
    if (out.length >= MAX_SOURCES) break;
  }
  return out;
}

function normalizeSopMeta(data: Record<string, unknown>): SopAnswerMeta | undefined {
  if (typeof data.grounded !== "boolean") return undefined;
  const reason = str(data.reason);
  const related: RelatedDocument[] = [];
  if (Array.isArray(data.related_documents)) {
    for (const item of data.related_documents) {
      const doc = record(item);
      const id = str(doc?.id);
      const title = str(doc?.title);
      if (!id || !title || !isValidEntityId(id)) continue;
      related.push({ id: id.toLowerCase(), title: title.slice(0, 120), category: str(doc?.category) });
      if (related.length >= 3) break;
    }
  }
  const lang = str(data.answer_language);
  return {
    grounded: data.grounded,
    reason: reason && (SOP_REASONS as readonly string[]).includes(reason) ? (reason as SopReason) : null,
    highRisk: data.high_risk === true,
    answerLanguage: lang === "en" || lang === "es" ? lang : null,
    related,
  };
}

function normalizeOptions(raw: unknown): ClarifyOption[] {
  if (!Array.isArray(raw)) return [];
  const out: ClarifyOption[] = [];
  for (const item of raw) {
    const option = record(item);
    const label = str(option?.label);
    const hint = str(option?.intent_hint);
    if (!label || !hint || !(CLARIFY_INTENT_HINTS as readonly string[]).includes(hint)) continue;
    out.push({ label: label.slice(0, 60), intentHint: hint as ClarifyIntentHint });
    if (out.length >= MAX_OPTIONS) break;
  }
  return out;
}

function previewsFrom(raw: unknown, build: (item: Record<string, unknown>) => ActionPreview | null): ActionPreview[] {
  if (!Array.isArray(raw)) return [];
  const out: ActionPreview[] = [];
  for (const item of raw.slice(0, MAX_ACTIONS)) {
    const obj = record(item);
    const preview = obj ? build(obj) : null;
    if (preview) out.push(preview);
  }
  return out;
}

const PREVIEW_SOURCES = {
  task_preview: { field: "tasks", build: taskDraftFromRaw },
  work_order_preview: { field: "work_orders", build: workOrderDraftFromRaw },
  guest_request_preview: { field: "requests", build: guestRequestDraftFromRaw },
} as const;

/**
 * Turn the raw `POST /ai/copilot/chat` body into one of the assistant's outcomes.
 * Throws `CopilotFailure("invalid_response")` for anything that is not a recognisable envelope.
 */
export function normalizeCopilotResponse(raw: unknown): CopilotOutcome {
  const data = record(record(raw)?.data);
  const type = str(data?.response_type);
  const message = str(data?.message);
  if (!data || !type || !message) throw new CopilotFailure("invalid_response", "Unrecognised assistant reply.");

  const base: OutcomeBase = {
    message,
    intent: str(data.intent),
    provenance: provenanceFromModel(data.model_used),
    trustedContext: normalizeTrustedContext(data.trusted_context),
  };

  switch (type) {
    case "answer":
      return { ...base, kind: "answer", sources: normalizeSources(data.sources), sop: normalizeSopMeta(data) };
    case "task_preview":
    case "work_order_preview":
    case "guest_request_preview": {
      const { field, build } = PREVIEW_SOURCES[type];
      const list = data[field];
      const actions = previewsFrom(list, build);
      if (actions.length > 0) return { ...base, kind: "actions", actions };
      // Previews were promised but none are usable: a malformed reply, never a success.
      if (!Array.isArray(list) || list.length > 0) {
        throw new CopilotFailure("invalid_response", "The assistant's suggestion could not be read.");
      }
      return { ...base, kind: "answer", sources: [] };
    }
    case "ambiguous": {
      const options = normalizeOptions(data.options);
      if (options.length === 0) return { ...base, kind: "answer", sources: [] };
      return { ...base, kind: "clarify", options };
    }
    default:
      // assignment_preview, insights, or anything newer: valid, but nothing this app may act on.
      return { ...base, kind: "unsupported" };
  }
}
