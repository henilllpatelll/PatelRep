import { api } from "./client";

export interface SOPDocument {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  page_count: number | null;
  indexing_status: "pending" | "processing" | "indexed" | "failed";
  created_at: string;
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

export async function listDocuments(): Promise<{ data: SOPDocument[] }> {
  return api.get<{ data: SOPDocument[] }>("/sop/documents");
}

export async function getDocument(id: string): Promise<{ data: SOPDocument }> {
  return api.get<{ data: SOPDocument }>(`/sop/documents/${id}`);
}

export async function querySOPs(query: string): Promise<{ data: SOPQueryResult }> {
  return api.post<{ data: SOPQueryResult }>("/sop/query", { query });
}
