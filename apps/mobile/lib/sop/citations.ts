import type { AssistantSource } from "@/lib/ai/contract";
import { isValidEntityId } from "@/lib/ai/launch";

/* ─── Source citations ──────────────────────────────────────────────────────
   A citation can only name what the server returned for it: the document's real
   title, its approved version, the page of the passage and a section label when
   the index has one. Anything missing is simply left out, and a source whose id
   is not shaped like a document id is shown as text and never linked. */

/** Where a cited document opens in the app, with the cited page when there is one. */
export function sourceHref(source: Pick<AssistantSource, "documentId" | "page">): string | null {
  if (!source.documentId || !isValidEntityId(source.documentId)) return null;
  const id = encodeURIComponent(source.documentId.toLowerCase());
  return source.page ? `/(app)/sop/${id}?page=${source.page}` : `/(app)/sop/${id}`;
}

export type Translate = (key: string, options?: Record<string, unknown>) => string;

/** "Version 2 · Section X · Page 3": only the parts the source really has. */
export function citationDetail(source: Pick<AssistantSource, "version" | "page" | "section">, t: Translate): string {
  const parts: string[] = [];
  if (source.version) parts.push(t("sop.citation.version", { version: source.version }));
  if (source.section) parts.push(t("sop.citation.section", { section: source.section }));
  if (source.page) parts.push(t("copilot.page", { page: source.page }));
  return parts.join(" · ");
}

/** A page number from a route parameter, or null when it is not a plain positive integer. */
export function parsePageParam(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !/^\d{1,4}$/.test(raw)) return null;
  const page = Number(raw);
  return page > 0 ? page : null;
}
