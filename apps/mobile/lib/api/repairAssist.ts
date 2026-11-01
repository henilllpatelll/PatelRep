import { api } from "@/lib/api/client";

/* AI repair assistance for one work order (POST /ai/engineer/work-orders/{id}/assist).
   The server loads every fact itself from the signed-in person's hotel; the phone sends only a mode, a question and
   what the technician has typed. The answer is a suggestion: nothing it says is recorded or acted on. */

export type AssistMode = "suggest" | "followup" | "draft_notes";

export interface AssistFacts {
  work_order: { number: string | number | null; title: string | null; category: string | null; priority: string | null; status: string | null; room: string | null };
  asset: { name: string | null; tag: string | null; manufacturer: string | null; category: string | null; location: string | null } | null;
  previous_repairs: { work_order_number: string | number | null; title: string | null; completed_at: string | null }[];
  pm_results_count: number;
  has_asset: boolean;
  /** Always false: manuals are not retrievable, so the assistant never claims to have read one. */
  manuals_consulted: boolean;
}

export interface AssistSuggestion {
  summary: string;
  checks: string[];
  needs_info: string[];
  safety: string[];
  uncertainty: string;
  answer: string;
  draft_notes: string;
}

export interface AssistTurn {
  role: "user" | "assistant";
  text: string;
}

export interface AssistResult {
  mode: AssistMode;
  facts: AssistFacts;
  suggestion: AssistSuggestion;
}

const ASSIST_TIMEOUT_MS = 35_000;

export async function requestRepairAssist(
  workOrderId: string,
  input: { mode: AssistMode; question?: string; technicianNotes?: string; history?: AssistTurn[]; language: "en" | "es" },
  signal?: AbortSignal,
): Promise<AssistResult> {
  const res = await api.post<{ data: AssistResult }>(
    `/ai/engineer/work-orders/${workOrderId}/assist`,
    {
      mode: input.mode,
      ...(input.question?.trim() ? { question: input.question.trim() } : {}),
      ...(input.technicianNotes?.trim() ? { technician_notes: input.technicianNotes.trim() } : {}),
      history: (input.history ?? []).slice(-4),
      language: input.language,
    },
    { signal, timeoutMs: ASSIST_TIMEOUT_MS },
  );
  return res.data;
}
