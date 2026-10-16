import { api } from "./client";

/** Approval facts read from the document's own controlled-document record; absent when the hotel recorded none. */
export interface SOPApproval {
  state: "approved";
  version: number | null;
  effective_date: string | null;
  review_date: string | null;
  approved_at: string | null;
}

export interface SOPDocument {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  page_count: number | null;
  indexing_status: "pending" | "processing" | "indexed" | "failed";
  created_at: string;
  updated_at?: string | null;
  indexed_at?: string | null;
  /** The assistant can answer from this document (it has been indexed). Reading never depends on it. */
  ai_ready?: boolean;
  approval?: SOPApproval | null;
}

export interface SOPQueryResult {
  answer: string;
  sources: Array<{
    content: string;
    similarity: number;
    document_id: string;
    metadata: Record<string, unknown>;
  }>;
  suggested_tasks: Array<{ title: string; task_type: string; priority: string }>;
}

/** A short-lived link to the original file, issued by the server for a document this person may read. */
export interface SOPFileLink {
  url: string;
  expires_in: number;
  content_type: string;
}

/** Legacy: every document of the hotel (the web manager's list). The app reads `listLibrary`. */
export async function listDocuments(): Promise<{ data: SOPDocument[] }> {
  return api.get<{ data: SOPDocument[] }>("/sop/documents");
}

export async function getDocument(id: string): Promise<{ data: SOPDocument }> {
  return api.get<{ data: SOPDocument }>(`/sop/documents/${id}`);
}

export async function querySOPs(query: string): Promise<{ data: SOPQueryResult }> {
  return api.post<{ data: SOPQueryResult }>("/sop/query", { query });
}

/** The procedures staff may read: no drafts, retired, expired or other-hotel documents. */
export async function listLibrary(): Promise<{ data: SOPDocument[] }> {
  return api.get<{ data: SOPDocument[] }>("/sop/library");
}

export async function getLibraryDocument(id: string): Promise<{ data: SOPDocument }> {
  return api.get<{ data: SOPDocument }>(`/sop/library/${encodeURIComponent(id)}`);
}

export async function getLibraryFile(id: string): Promise<{ data: SOPFileLink }> {
  return api.get<{ data: SOPFileLink }>(`/sop/library/${encodeURIComponent(id)}/file`);
}
