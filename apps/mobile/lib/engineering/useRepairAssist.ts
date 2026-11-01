import { useCallback, useEffect, useRef, useState } from "react";
import { requestRepairAssist, type AssistFacts, type AssistMode, type AssistSuggestion, type AssistTurn } from "@/lib/api/repairAssist";
import { classifyAssistError, trimHistory, type AssistFailure } from "@/lib/engineering/repairAssist";

export interface RepairAssistHandle {
  status: "idle" | "loading" | "ready" | "error";
  facts: AssistFacts | null;
  /** The latest troubleshooting suggestion (mode "suggest"). */
  suggestion: AssistSuggestion | null;
  /** Follow-up questions and their answers, newest last. Held in memory only; closing the sheet forgets them. */
  turns: AssistTurn[];
  /** The latest repair-note draft, for the technician to edit. Never saved by this hook. */
  draftNotes: string | null;
  failure: AssistFailure | null;
  ask: (mode: AssistMode, input?: { question?: string; technicianNotes?: string }) => Promise<void>;
  /** Stops a request that is still waiting (the person closed the sheet or pressed Cancel). */
  cancel: () => void;
  reset: () => void;
}

/**
 * One assistant request at a time for one work order. A reply is applied only if it is still the newest request for
 * the same order; cancelling or closing drops the answer. Nothing is persisted and nothing is written to the work order.
 */
export function useRepairAssist(workOrderId: string, language: "en" | "es"): RepairAssistHandle {
  const [status, setStatus] = useState<RepairAssistHandle["status"]>("idle");
  const [facts, setFacts] = useState<AssistFacts | null>(null);
  const [suggestion, setSuggestion] = useState<AssistSuggestion | null>(null);
  const [turns, setTurns] = useState<AssistTurn[]>([]);
  const [draftNotes, setDraftNotes] = useState<string | null>(null);
  const [failure, setFailure] = useState<AssistFailure | null>(null);
  const ticket = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const turnsRef = useRef<AssistTurn[]>([]);
  turnsRef.current = turns;

  const cancel = useCallback(() => {
    ticket.current += 1;
    controller.current?.abort();
    controller.current = null;
    setStatus((current) => (current === "loading" ? "idle" : current));
  }, []);

  const reset = useCallback(() => {
    cancel();
    setStatus("idle");
    setFacts(null);
    setSuggestion(null);
    setTurns([]);
    setDraftNotes(null);
    setFailure(null);
  }, [cancel]);

  const ask = useCallback<RepairAssistHandle["ask"]>(
    async (mode, input = {}) => {
      if (controller.current) return; // a request is already waiting: no second one
      const mine = ++ticket.current;
      const abort = new AbortController();
      controller.current = abort;
      setStatus("loading");
      setFailure(null);
      try {
        const result = await requestRepairAssist(
          workOrderId,
          { mode, question: input.question, technicianNotes: input.technicianNotes, history: mode === "followup" ? trimHistory(turnsRef.current) : [], language },
          abort.signal,
        );
        if (mine !== ticket.current) return;
        setFacts(result.facts);
        if (mode === "suggest") setSuggestion(result.suggestion);
        if (mode === "followup" && input.question) {
          setTurns((prev) => [...prev, { role: "user", text: input.question as string }, { role: "assistant", text: result.suggestion.answer }]);
        }
        if (mode === "draft_notes") setDraftNotes(result.suggestion.draft_notes);
        setStatus("ready");
      } catch (err) {
        if (mine !== ticket.current || abort.signal.aborted) return;
        setFailure(classifyAssistError(err));
        setStatus("error");
      } finally {
        if (mine === ticket.current) controller.current = null;
      }
    },
    [workOrderId, language],
  );

  // A different order, or leaving the screen, drops anything in flight and anything shown.
  useEffect(() => {
    reset();
    return () => {
      ticket.current += 1;
      controller.current?.abort();
      controller.current = null;
    };
  }, [workOrderId, reset]);

  return { status, facts, suggestion, turns, draftNotes, failure, ask, cancel, reset };
}
