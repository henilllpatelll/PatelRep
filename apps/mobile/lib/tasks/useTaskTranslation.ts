import { useCallback, useEffect, useRef, useState } from "react";
import { translateTask, type TaskTranslation, type TranslationLanguage } from "@/lib/api/translation";
import { onAssistantSessionReset } from "@/lib/ai/session";
import type { Task } from "@/lib/api/tasks";

/* ─── Translating one task's instructions ───────────────────────────────────
   Asks the server to translate the task the person is looking at. The stored
   task is never touched and the original is always still on screen. A result
   is kept in memory only while the task's wording is unchanged (the key holds
   the text itself), so an edited task is translated afresh, and nothing here is
   charged twice for looking at the same words again. Nothing runs on its own:
   a translation is fetched only when the person asks for one. */

export type TranslationStatus = "idle" | "loading" | "ready" | "failed" | "offline";

const memory = new Map<string, TaskTranslation>();
const MAX_REMEMBERED = 30;

onAssistantSessionReset(() => memory.clear());

/** Stable for the same wording; different the moment the title or description changes. */
export function translationKey(task: Pick<Task, "id" | "title" | "description">, language: TranslationLanguage): string {
  return `${task.id}␟${language}␟${task.title}␟${task.description ?? ""}`;
}

export interface TaskTranslationState {
  status: TranslationStatus;
  language: TranslationLanguage | null;
  result: TaskTranslation | null;
  translate: (language: TranslationLanguage) => Promise<void>;
  reset: () => void;
}

export function useTaskTranslation(task: Pick<Task, "id" | "title" | "description"> | null, offline: boolean): TaskTranslationState {
  const [status, setStatus] = useState<TranslationStatus>("idle");
  const [language, setLanguage] = useState<TranslationLanguage | null>(null);
  const [result, setResult] = useState<TaskTranslation | null>(null);
  const flight = useRef(0);
  const wording = task ? `${task.id}␟${task.title}␟${task.description ?? ""}` : "";

  const reset = useCallback(() => {
    flight.current += 1;
    setStatus("idle");
    setLanguage(null);
    setResult(null);
  }, []);

  // Another task, or the same task with new wording: whatever was translated no longer describes it.
  useEffect(() => {
    reset();
  }, [wording, reset]);

  const translate = useCallback(
    async (target: TranslationLanguage) => {
      if (!task) return;
      const mine = (flight.current += 1);
      setLanguage(target);
      const remembered = memory.get(translationKey(task, target));
      if (remembered) {
        setResult(remembered);
        setStatus("ready");
        return;
      }
      if (offline) {
        setResult(null);
        setStatus("offline");
        return;
      }
      setStatus("loading");
      try {
        const { data } = await translateTask(task.id, target);
        if (flight.current !== mine) return;
        if (!data?.translated || typeof data.translated.title !== "string" || !data.translated.title.trim()) throw new Error("empty translation");
        if (memory.size >= MAX_REMEMBERED) memory.delete(memory.keys().next().value as string);
        memory.set(translationKey(task, target), data);
        setResult(data);
        setStatus("ready");
      } catch {
        if (flight.current !== mine) return;
        setResult(null);
        setStatus("failed");
      }
    },
    [task, offline],
  );

  return { status, language, result, translate, reset };
}
