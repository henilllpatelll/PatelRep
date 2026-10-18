import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AssistantContextIds } from "@/lib/ai/copilotChat";
import { useAiCapability } from "@/lib/ai/capabilities";
import { assistantScope } from "@/lib/ai/session";
import {
  buildSupervisorCopilot,
  resolveRoomContext,
  type SupervisorCopilotModel,
} from "@/lib/ai/supervisorCopilot";
import {
  buildSummaryRequest,
  isSummaryPending,
  peekSupervisorSummary,
  requestSupervisorSummary,
  summaryFingerprint,
  type SummaryFailure,
  type SummaryResult,
} from "@/lib/ai/supervisorSummaryAi";
import { useSupervisorToday } from "@/lib/housekeeping/useSupervisorToday";
import type { SupervisorToday } from "@/lib/housekeeping/supervisorToday";
import { useAppStore } from "@/stores/appStore";
import { clearSupervisorCopilotRoom, useSupervisorCopilotStore } from "@/stores/supervisorCopilotStore";

export type AiSummaryView =
  /** The hotel has the AI assistant switched off (or the capability is not known yet): no paid button is offered. */
  | { status: "disabled" }
  /** Nothing asked yet. `canAsk` is false when there is nothing true to put into words (no board). */
  | { status: "idle"; canAsk: boolean }
  | { status: "pending" }
  /** `current` is false when the figures changed since the answer was written: it is labelled as earlier data. */
  | { status: "ready"; result: SummaryResult; current: boolean; cached: boolean }
  | { status: "failed"; failure: SummaryFailure; retryAfterMs?: number; earlier: SummaryResult | null };

export interface SupervisorCopilotController {
  today: SupervisorToday;
  model: SupervisorCopilotModel;
  refreshing: boolean;
  /** The room this conversation is about, re-verified against the current board. */
  room: ReturnType<typeof resolveRoomContext>;
  clearRoom: () => void;
  /** Ids the chat sends with every message (the server re-verifies them). */
  chatContext: AssistantContextIds | undefined;
  summary: AiSummaryView;
  /** Ask the model to word the figures on screen. Only a tap calls this. */
  askSummary: (force?: boolean) => Promise<void>;
  language: "en" | "es";
  zone: string | null;
}

/**
 * The supervisor Copilot's data: the shared Today snapshot (free), the deterministic model built from it, and
 * the optional paid wording. Mounted only while the Copilot is open. Nothing here asks a model by itself:
 * `askSummary` is the single paid call and only a tap reaches it.
 */
export function useSupervisorCopilot(): SupervisorCopilotController {
  const { t, i18n } = useTranslation();
  const language: "en" | "es" = i18n.language?.startsWith("es") ? "es" : "en";
  const user = useAppStore((state) => state.user);
  const isOnline = useAppStore((state) => state.isOnline);
  const zone = useAppStore((state) => state.hotelTimezone ?? null);
  const scope = assistantScope(user);
  const aiOn = useAiCapability("unifiedAssistant");

  const { today, refreshing } = useSupervisorToday({ viewerId: user?.id ?? null, scopeKey: scope, reuseFresh: true });
  const model = useMemo(
    () => buildSupervisorCopilot(today, { zone, language, someone: t("supervisorToday.attention.someone") }),
    [today, zone, language, t],
  );

  // What the Copilot was opened about. A different person's context is never read.
  const storedRoom = useSupervisorCopilotStore((state) => (scope !== null && state.scope === scope ? state.room : null));
  const room = useMemo(() => resolveRoomContext(storedRoom, today.sources), [storedRoom, today.sources]);
  const clearRoom = useCallback(() => clearSupervisorCopilotRoom(), []);
  const chatContext = room.state === "ok" ? { roomId: room.room.roomId } : undefined;

  // ── Optional paid wording ─────────────────────────────────────────────────
  const body = useMemo(() => buildSummaryRequest(today, model, "shift", language), [today, model, language]);
  const fingerprint = body ? summaryFingerprint(body) : null;
  const [asked, setAsked] = useState<{ status: "pending" } | { status: "failed"; failure: SummaryFailure; retryAfterMs?: number } | null>(
    () => (isSummaryPending(scope, "shift") ? { status: "pending" } : null),
  );
  const [tick, setTick] = useState(0);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // A different person starts with no ask in progress and no failure from the previous one.
  useEffect(() => {
    setAsked(null);
  }, [scope]);

  const bodyRef = useRef(body);
  bodyRef.current = body;
  const onlineRef = useRef(isOnline);
  onlineRef.current = isOnline;

  const askSummary = useCallback(
    async (force = false) => {
      const mine = scopeRef.current;
      if (!mine) return;
      setAsked({ status: "pending" });
      const outcome = await requestSupervisorSummary({
        scope: mine,
        body: bodyRef.current,
        online: onlineRef.current,
        force,
        stillCurrent: () => scopeRef.current === mine,
      });
      if (!mounted.current || scopeRef.current !== mine) return;
      if (outcome.ok) setAsked(null);
      else setAsked({ status: "failed", failure: outcome.failure, retryAfterMs: outcome.retryAfterMs });
      setTick((n) => n + 1);
    },
    [],
  );

  const summary: AiSummaryView = useMemo(() => {
    void tick;
    if (!aiOn) return { status: "disabled" };
    if (asked?.status === "pending") return { status: "pending" };
    const stored = peekSupervisorSummary(scope, "shift", fingerprint);
    if (asked?.status === "failed") {
      return { status: "failed", failure: asked.failure, retryAfterMs: asked.retryAfterMs, earlier: stored?.result ?? null };
    }
    if (stored) return { status: "ready", result: stored.result, current: stored.current, cached: true };
    return { status: "idle", canAsk: body !== null };
  }, [aiOn, asked, scope, fingerprint, body, tick]);

  return { today, model, refreshing, room, clearRoom, chatContext, summary, askSummary, language, zone };
}
