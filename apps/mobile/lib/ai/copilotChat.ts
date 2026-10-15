import { api } from "@/lib/api/client";
import {
  CopilotFailure,
  normalizeCopilotResponse,
  toCopilotFailure,
  type IntentHint,
  type CopilotOutcome,
} from "@/lib/ai/contract";
import { CONFIRM_PATH, buildConfirmBody, isPreviewValid, type ActionPreview } from "@/lib/ai/drafts";

// The one place the assistant talks to /ai/copilot/chat and the three confirm endpoints.
// Shared by the full chat screen and the corner card, through lib/ai/useAssistantConversation.

/** Ids the server re-verifies against this hotel (and the person's own assignments) before use. */
export interface AssistantContextIds {
  roomId?: string;
  taskId?: string;
  documentId?: string;
}

export interface SendOptions {
  /** Steers the intent; the server whitelists it and checks it against the person's real role. */
  intentHint?: IntentHint;
  context?: AssistantContextIds;
  /** Lets the person cancel a request that is still waiting for its answer. */
  signal?: AbortSignal;
}

/**
 * Ask the assistant. The reply is always the normalised `CopilotOutcome`; every failure is a
 * `CopilotFailure`. No role is sent: the server uses the one in the person's verified token.
 */
export async function sendCopilotMessage(text: string, options: SendOptions = {}): Promise<CopilotOutcome> {
  // `context` must be an object -- the API validates Optional[dict] and reads intent_hint from it.
  const context: Record<string, string> = { source: "mobile" };
  if (options.intentHint) context.intent_hint = options.intentHint;
  if (options.context?.roomId) context.room_id = options.context.roomId;
  if (options.context?.taskId) context.task_id = options.context.taskId;
  if (options.context?.documentId) context.document_id = options.context.documentId;

  let raw: unknown;
  try {
    const body = { message: text, context };
    raw = options.signal
      ? await api.post<unknown>("/ai/copilot/chat", body, { signal: options.signal })
      : await api.post<unknown>("/ai/copilot/chat", body);
  } catch (error) {
    if (isAbort(error)) throw error;
    throw toCopilotFailure(error);
  }
  return normalizeCopilotResponse(raw);
}

/** The request was cancelled by the person; not a failure. */
export function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export interface ConfirmResult {
  createdCount: number;
  /** The server recognised a repeat of an earlier confirm and returned that record instead of a new one. */
  deduplicated: boolean;
}

/**
 * Create what one reviewed preview describes, after the person's explicit confirmation.
 * Success means the SERVER says it created (or already had) the record -- an empty or unreadable
 * answer is a failure, never a success. `requestKey` is stable per preview so a retry is idempotent.
 */
export async function confirmAction(preview: ActionPreview, requestKey: string): Promise<ConfirmResult> {
  if (!isPreviewValid(preview)) throw new CopilotFailure("invalid_request", "The suggestion is incomplete.");

  let raw: unknown;
  try {
    raw = await api.post<unknown>(CONFIRM_PATH[preview.kind], buildConfirmBody(preview, requestKey));
  } catch (error) {
    throw toCopilotFailure(error);
  }
  const body = (raw && typeof raw === "object" ? raw : {}) as {
    data?: { created_count?: unknown };
    meta?: { deduplicated?: unknown };
  };
  const created = body.data?.created_count;
  if (typeof created !== "number" || created < 1) {
    throw new CopilotFailure("unconfirmed", "The server did not confirm the request.");
  }
  return { createdCount: created, deduplicated: typeof body.meta?.deduplicated === "number" && body.meta.deduplicated > 0 };
}

/** A fresh RFC 4122 v4 id (the API validates idempotency keys as UUID4). */
export function newRequestKey(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
