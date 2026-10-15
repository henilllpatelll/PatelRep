import { API_BASE, ApiError } from "@/lib/api/client";
import { CopilotFailure, toCopilotFailure } from "@/lib/ai/contract";
import { discardLocalPhoto } from "@/lib/housekeeping/photoAsset";
import { prepareForUpload } from "@/lib/housekeeping/photo";
import { MAINTENANCE_CATEGORIES, type MaintenanceCategory } from "@/lib/housekeeping/maintenanceReport";
import { supabase } from "@/lib/supabase";

/* ─── Optional AI help with one maintenance photo ───────────────────────────
   POST /ai/photo-analysis answers a SUGGESTION: a category and one short sentence about what is visible
   (or "unable to determine"). It creates nothing. This module is the only place the app sends a photo to
   the AI service, and it does so only when a person pressed "Analyze photo": the photo is shrunk first, goes
   to the authenticated backend (never to a provider directly), and the app's cached copy is deleted
   afterwards. The reply is checked again here: an unknown category, a missing sentence or a malformed body
   never becomes a suggestion. */

export type PhotoAnalysisOutcome = "suggestion" | "unable_to_determine";

export interface PhotoAnalysis {
  outcome: PhotoAnalysisOutcome;
  /** What is visible, in the model's words. Always shown as "unverified". */
  observation: string | null;
  category: MaintenanceCategory | null;
  /** One optional yes/no question the model would like answered. */
  question: string | null;
}

export const UNABLE_TO_DETERMINE: PhotoAnalysis = { outcome: "unable_to_determine", observation: null, category: null, question: null };

const MAX_OBSERVATION = 240;
const MAX_QUESTION = 120;
/** Photo upload + a vision model take longer than the JSON calls' 12 s. */
const ANALYSIS_TIMEOUT_MS = 45_000;

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, max) : null;
}

/** Reduce the API body to a `PhotoAnalysis`, or throw `invalid_response` when it is not recognisable. */
export function normalizePhotoAnalysis(raw: unknown): PhotoAnalysis {
  const data = (raw as { data?: unknown } | null)?.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new CopilotFailure("invalid_response", "Unrecognised photo analysis reply.");
  }
  const body = data as Record<string, unknown>;
  if (body.outcome !== "suggestion" && body.outcome !== "unable_to_determine") {
    throw new CopilotFailure("invalid_response", "Unrecognised photo analysis reply.");
  }
  const observation = text(body.observation, MAX_OBSERVATION);
  if (body.outcome === "unable_to_determine" || !observation) return UNABLE_TO_DETERMINE;
  const category = typeof body.suggested_category === "string" ? body.suggested_category.trim().toLowerCase() : "";
  const question = text(body.question, MAX_QUESTION);
  return {
    outcome: "suggestion",
    observation,
    category: (MAINTENANCE_CATEGORIES as readonly string[]).includes(category) ? (category as MaintenanceCategory) : null,
    question: question && question.endsWith("?") ? question : null,
  };
}

export interface AnalyzeInput {
  /** The photo the person chose (the original; a smaller copy is made and removed again). */
  uri: string;
  /** What the person wrote, as context for the model. Optional. */
  description?: string;
  /** The verified room, so the server can check the person may report on it. Optional. */
  roomId?: string;
  signal?: AbortSignal;
}

function abortError(): Error {
  const error = new Error("Request cancelled.");
  error.name = "AbortError";
  return error;
}

/**
 * Send ONE photo for analysis. Throws `CopilotFailure` (kinds: offline, credit_limit, rate_limited, unavailable,
 * permission, not_found, invalid_request, invalid_response, unauthenticated) or an `AbortError` when cancelled.
 */
export async function analyzeIssuePhoto(input: AnalyzeInput): Promise<PhotoAnalysis> {
  if (input.signal?.aborted) throw abortError();
  let prepared: string | null = null;
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const onAbort = () => controller?.abort();
  input.signal?.addEventListener("abort", onAbort);
  const timer = setTimeout(() => controller?.abort(), ANALYSIS_TIMEOUT_MS);
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) throw new CopilotFailure("unauthenticated", "Not authenticated");

    prepared = await prepareForUpload(input.uri);
    const form = new FormData();
    form.append("file", { uri: prepared, type: "image/jpeg", name: "issue.jpg" } as unknown as Blob);
    const note = input.description?.trim();
    if (note) form.append("description", note.slice(0, 500));
    if (input.roomId) form.append("room_id", input.roomId);

    const response = await fetch(`${API_BASE}/ai/photo-analysis`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
      body: form,
      signal: controller?.signal,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ detail: "Unknown error" }));
      const detail = (body as { detail?: unknown }).detail;
      const message = typeof detail === "string" ? detail : `HTTP ${response.status}`;
      // Too large / not a supported image: the person can act on this (choose another photo or skip the analysis).
      if (response.status === 413 || response.status === 415) throw new CopilotFailure("invalid_request", message, response.status);
      throw toCopilotFailure(new ApiError(message, response.status));
    }
    return normalizePhotoAnalysis(await response.json());
  } catch (error) {
    if (input.signal?.aborted) throw abortError();
    if (controller?.signal.aborted) throw new CopilotFailure("unavailable", "The analysis took too long.");
    throw error instanceof CopilotFailure ? error : toCopilotFailure(error);
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", onAbort);
    discardLocalPhoto(prepared);
  }
}
