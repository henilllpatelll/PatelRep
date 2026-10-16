import type { SOPDocument } from "@/lib/api/sop";

/* ─── The procedure library, as pure rules ──────────────────────────────────
   Search, grouping, status wording and suggested questions for the SOP library
   and document screens. Nothing here calls a model or the network: ordinary
   search must keep working when the assistant is unavailable, and every status
   shown comes from the document's own record, never from a default. */

/** Lower-case, accent-free text so "Habitación" and "habitacion" match. */
export function fold(text: string | null | undefined): string {
  return (text ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Documents whose title, category or description contains EVERY word typed. An empty search keeps them all. */
export function searchDocuments(docs: SOPDocument[], query: string): SOPDocument[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return docs;
  return docs.filter((doc) => {
    const haystack = fold(`${doc.title} ${doc.category ?? ""} ${doc.description ?? ""}`);
    return words.every((word) => haystack.includes(word));
  });
}

const QUESTION_START =
  /^(how|what|where|when|why|which|who|can|could|do|does|did|is|are|should|must|may|c[oó]mo|qu[eé]|d[oó]nde|cu[aá]ndo|por qu[eé]|cu[aá]l|qui[eé]n|puedo|debo|se puede|hay)\b/i;

/** True when the text reads as a question to ask rather than a name to look up. */
export function looksLikeQuestion(text: string): boolean {
  const value = text.trim();
  if (value.length < 3) return false;
  return /[?¿]/.test(value) || QUESTION_START.test(value) || value.split(/\s+/).length >= 5;
}

export interface DocumentStatus {
  /** "approved" only when the hotel's own approval record says so; "uploaded" claims nothing. */
  kind: "approved" | "uploaded";
  version: number | null;
  reviewDate: string | null;
}

export function documentStatus(doc: Pick<SOPDocument, "approval">): DocumentStatus {
  const approval = doc.approval;
  if (!approval || approval.state !== "approved") return { kind: "uploaded", version: null, reviewDate: null };
  return { kind: "approved", version: approval.version ?? null, reviewDate: approval.review_date ?? null };
}

/** A calendar date as "Oct 2, 2026" / "2 oct 2026", or null when the value is missing or unreadable. */
export function formatDocumentDate(value: string | null | undefined, language: string): string | null {
  if (!value) return null;
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return date.toLocaleDateString(language.startsWith("es") ? "es-US" : "en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return null;
  }
}

/** Newest first, then A-Z, so the list does not reshuffle between visits. */
export function sortDocuments(docs: SOPDocument[]): SOPDocument[] {
  return [...docs].sort((a, b) => {
    const delta = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    return Number.isFinite(delta) && delta !== 0 ? delta : a.title.localeCompare(b.title);
  });
}

export interface SuggestedQuestion {
  documentId: string;
  title: string;
}

/**
 * Questions worth offering: one per document the assistant can really answer from, so a suggestion is never
 * about a procedure the hotel does not have. No documents the assistant can use means no suggestions.
 */
export function suggestedQuestions(docs: SOPDocument[], limit = 3): SuggestedQuestion[] {
  return sortDocuments(docs)
    .filter((doc) => doc.ai_ready === true || (doc.ai_ready === undefined && doc.indexing_status === "indexed"))
    .slice(0, limit)
    .map((doc) => ({ documentId: doc.id, title: doc.title }));
}

export type FreshnessUnit = "justNow" | "minutes" | "hours" | "days";

/** How long ago the saved copy was made, in the coarsest honest unit. */
export function freshnessOf(savedAt: number, now: number = Date.now()): { unit: FreshnessUnit; value: number } {
  const minutes = Math.max(0, Math.floor((now - savedAt) / 60000));
  if (minutes < 1) return { unit: "justNow", value: 0 };
  if (minutes < 60) return { unit: "minutes", value: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { unit: "hours", value: hours };
  return { unit: "days", value: Math.floor(hours / 24) };
}
