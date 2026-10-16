import { api } from "./client";

export type TranslationLanguage = "en" | "es";

export interface TaskTranslation {
  original: { title: string; description: string | null };
  translated: { title: string; description: string | null };
  target_language: TranslationLanguage;
  /** Served from an earlier translation of this exact text (nothing was charged). */
  cached: boolean;
  /** Always true: the wording was written by AI and is an aid to understanding, never a replacement for the task. */
  ai_generated: boolean;
  credits_used: number;
}

/** Translate one task's title and description. Read-only: the stored task is never changed. */
export async function translateTask(taskId: string, targetLanguage: TranslationLanguage): Promise<{ data: TaskTranslation }> {
  return api.post<{ data: TaskTranslation }>(`/ai/tasks/${encodeURIComponent(taskId)}/translate`, { target_language: targetLanguage });
}
