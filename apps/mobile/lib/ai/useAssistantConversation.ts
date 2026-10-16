import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { useAppStore } from "@/stores/appStore";
import { CopilotFailure, toCopilotFailure, type ClarifyOption, type CopilotOutcome } from "@/lib/ai/contract";
import {
  confirmAction,
  isAbort,
  newRequestKey,
  sendCopilotMessage,
  type AssistantContextIds,
  type SendOptions,
} from "@/lib/ai/copilotChat";
import {
  conversationReducer,
  initialConversation,
  toPersistable,
  type ActionItem,
  type AssistantMessage,
  type ConversationState,
  type LocalCard,
} from "@/lib/ai/conversationState";
import { isPreviewValid, type DraftPatch } from "@/lib/ai/drafts";
import { clearHistory as clearSavedHistory, loadHistory, saveHistory } from "@/lib/ai/history";
import { assistantScope, onAssistantSessionReset } from "@/lib/ai/session";

/** Longest message the API accepts (CopilotChatRequest.message is 4000; the inputs cap at 500). */
export const MAX_MESSAGE_CHARS = 500;

export interface AssistantConversation {
  messages: AssistantMessage[];
  sending: boolean;
  online: boolean;
  /** `${tenantId}:${userId}` of the open conversation, or null when signed out. */
  scope: string | null;
  send: (text: string, options?: SendOptions) => Promise<void>;
  /** The person picked one of the assistant's clarification options: ask again with that intent. */
  chooseOption: (message: AssistantMessage, option: ClarifyOption) => Promise<void>;
  editAction: (messageId: string, actionId: string, patch: DraftPatch) => void;
  /** Create what the person reviewed. Nothing is created until this is called. */
  confirm: (messageId: string, actionId: string) => Promise<void>;
  dismissAction: (messageId: string, actionId: string) => void;
  /** Add a question and an answer the app composed from the person's own data. Nothing is sent anywhere. */
  showLocal: (question: string, answer: string, card: LocalCard) => void;
  /** Stop waiting for the reply to the message in flight. Returns the question's text so it can be put back in the composer. */
  cancel: () => string | null;
  /** Forget the open conversation and its saved copy; the next message starts fresh. */
  startNewConversation: () => void;
  /** Remove this person's saved conversation (and the open one). */
  clearHistory: () => Promise<void>;
}

interface Options {
  /** Keep the conversation (text only) in secure storage so it survives a restart. Default false. */
  persist?: boolean;
  /** Ids sent with every message; the server verifies them for this person before using them. */
  context?: AssistantContextIds;
}

let counter = 0;
const nextId = (prefix: string) => `${prefix}${Date.now().toString(36)}-${(counter += 1).toString(36)}`;

function toActionItems(outcome: Extract<CopilotOutcome, { kind: "actions" }>): ActionItem[] {
  return outcome.actions.map((preview) => ({
    id: nextId("a"),
    preview,
    status: "ready",
    requestKey: newRequestKey(),
    failure: null,
    failureMessage: null,
    deduplicated: false,
  }));
}

function replyFromOutcome(outcome: CopilotOutcome, askedText: string): AssistantMessage {
  const base: AssistantMessage = {
    id: nextId("m"),
    role: "assistant",
    content: outcome.message,
    at: Date.now(),
    kind: outcome.kind,
    provenance: outcome.provenance,
    trusted: outcome.trustedContext,
    askedText,
  };
  switch (outcome.kind) {
    case "answer":
      return { ...base, sources: outcome.sources, ...(outcome.sop ? { sop: outcome.sop } : {}) };
    case "actions":
      return { ...base, actions: toActionItems(outcome) };
    case "clarify":
      return { ...base, options: outcome.options };
    case "unsupported":
      return base;
  }
}

const noticeMessage = (kind: CopilotFailure["kind"], askedText?: string): AssistantMessage => ({
  id: nextId("m"),
  role: "assistant",
  content: "",
  at: Date.now(),
  kind: "notice",
  notice: kind,
  askedText,
});

/**
 * The one conversation controller behind every assistant surface. It owns: whose conversation this is
 * (it is dropped the instant the signed-in person or hotel changes), sending, the actions the assistant
 * proposes (edit -> explicit confirm -> server-confirmed result), duplicate-tap protection, offline and
 * failure states, and optional text-only saved history.
 */
export function useAssistantConversation({ persist = false, context }: Options = {}): AssistantConversation {
  const user = useAppStore((state) => state.user);
  const isOnline = useAppStore((state) => state.isOnline);
  const scope = assistantScope(user);

  const [state, dispatch] = useReducer(conversationReducer, scope, (initial): ConversationState => initialConversation(initial));
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const stateRef = useRef(state);
  stateRef.current = state;
  const onlineRef = useRef(isOnline);
  onlineRef.current = isOnline;
  const contextRef = useRef(context);
  contextRef.current = context;
  const sendingRef = useRef(false);
  const confirmingRef = useRef(new Set<string>());
  // The one request that may still answer. Anything else coming back (cancelled, superseded, another person) is dropped.
  const flightRef = useRef<{ messageId: string; text: string; controller: AbortController } | null>(null);

  const abortFlight = useCallback(() => {
    const flight = flightRef.current;
    flightRef.current = null;
    sendingRef.current = false;
    flight?.controller.abort();
    return flight;
  }, []);

  // A different person or hotel (or sign-out) never sees the previous conversation.
  useEffect(() => {
    abortFlight();
    dispatch({ type: "scope", scope });
  }, [scope, abortFlight]);

  // Sign-out / account switch resets everything held in memory, even if this component stays mounted.
  useEffect(
    () =>
      onAssistantSessionReset(() => {
        abortFlight();
        confirmingRef.current.clear();
        // Empty at once; the scope effect above then starts the new person's conversation.
        dispatch({ type: "clear" });
      }),
    [abortFlight],
  );

  // Saved history for this person, read once per conversation.
  useEffect(() => {
    if (!scope) return;
    if (!persist) {
      dispatch({ type: "hydrate", scope, stored: [] });
      return;
    }
    let live = true;
    void loadHistory(scope).then((stored) => {
      if (live && scopeRef.current === scope) dispatch({ type: "hydrate", scope, stored });
    });
    return () => {
      live = false;
    };
  }, [scope, persist]);

  // Keep the saved copy in step with the conversation, once the saved lines have been read.
  useEffect(() => {
    if (!persist || !scope || !state.hydrated || state.scope !== scope || state.sending) return;
    void saveHistory(scope, toPersistable(state.messages));
  }, [persist, scope, state.hydrated, state.scope, state.sending, state.messages]);

  const send = useCallback(async (text: string, options: SendOptions = {}) => {
    const trimmed = text.trim().slice(0, MAX_MESSAGE_CHARS);
    const mine = scopeRef.current;
    if (!trimmed || !mine || sendingRef.current) return;
    // A double tap while a (paid) request is on its way is one request, not two.
    sendingRef.current = true;
    const messageId = nextId("m");
    const flight = { messageId, text: trimmed, controller: new AbortController() };
    flightRef.current = flight;
    dispatch({ type: "sent", message: { id: messageId, role: "user", content: trimmed, at: Date.now() } });
    // Only the request that is still `flightRef` may answer: cancelled, superseded or another person's replies are dropped.
    const current = () => flightRef.current === flight && scopeRef.current === mine;
    try {
      if (!onlineRef.current) throw new CopilotFailure("offline", "offline");
      const outcome = await sendCopilotMessage(trimmed, {
        ...options,
        context: options.context ?? contextRef.current,
        signal: flight.controller.signal,
      });
      if (!current()) return;
      dispatch({ type: "replied", message: replyFromOutcome(outcome, trimmed) });
    } catch (error) {
      if (!current() || isAbort(error)) return;
      dispatch({ type: "replied", message: noticeMessage(toCopilotFailure(error).kind, trimmed) });
    } finally {
      if (flightRef.current === flight) {
        flightRef.current = null;
        sendingRef.current = false;
      }
    }
  }, []);

  const showLocal = useCallback((question: string, answer: string, card: LocalCard) => {
    if (!scopeRef.current || sendingRef.current) return;
    const at = Date.now();
    dispatch({
      type: "local",
      messages: [
        { id: nextId("m"), role: "user", content: question, at },
        { id: nextId("m"), role: "assistant", content: answer, at, kind: "local", provenance: "verified", local: card },
      ],
    });
  }, []);

  const cancel = useCallback((): string | null => {
    const flight = abortFlight();
    if (!flight) return null;
    dispatch({ type: "cancel", messageId: flight.messageId });
    return flight.text;
  }, [abortFlight]);

  const chooseOption = useCallback(
    async (message: AssistantMessage, option: ClarifyOption) => {
      if (!message.askedText) return;
      await send(message.askedText, { intentHint: option.intentHint });
    },
    [send],
  );

  const editAction = useCallback((messageId: string, actionId: string, patch: DraftPatch) => {
    dispatch({ type: "edit", messageId, actionId, patch });
  }, []);

  const dismissAction = useCallback((messageId: string, actionId: string) => {
    dispatch({ type: "action", messageId, actionId, patch: { status: "dismissed" } });
  }, []);

  const confirm = useCallback(async (messageId: string, actionId: string) => {
    const mine = scopeRef.current;
    const item = stateRef.current.messages.find((m) => m.id === messageId)?.actions?.find((a) => a.id === actionId);
    if (!mine || !item) return;
    // One create per preview at a time, and never again once it was created.
    if (
      confirmingRef.current.has(actionId) ||
      item.status === "confirming" ||
      item.status === "confirmed" ||
      item.status === "dismissed"
    ) {
      return;
    }
    if (!isPreviewValid(item.preview)) {
      dispatch({ type: "action", messageId, actionId, patch: { status: "failed", failure: "invalid_request", failureMessage: null } });
      return;
    }
    if (!onlineRef.current) {
      dispatch({ type: "action", messageId, actionId, patch: { status: "failed", failure: "offline", failureMessage: null } });
      return;
    }
    confirmingRef.current.add(actionId);
    dispatch({ type: "action", messageId, actionId, patch: { status: "confirming", failure: null, failureMessage: null } });
    try {
      const result = await confirmAction(item.preview, item.requestKey);
      if (scopeRef.current !== mine) return;
      dispatch({ type: "action", messageId, actionId, patch: { status: "confirmed", deduplicated: result.deduplicated } });
    } catch (error) {
      if (scopeRef.current !== mine) return;
      const failure = toCopilotFailure(error);
      dispatch({
        type: "action",
        messageId,
        actionId,
        // The server's own words are only worth showing when they explain a refusal of THIS preview.
        patch: {
          status: "failed",
          failure: failure.kind,
          failureMessage: failure.kind === "invalid_request" ? failure.message : null,
        },
      });
    } finally {
      confirmingRef.current.delete(actionId);
    }
  }, []);

  const startNewConversation = useCallback(() => {
    abortFlight();
    dispatch({ type: "clear" });
    if (persist && scopeRef.current) void clearSavedHistory(scopeRef.current);
  }, [persist, abortFlight]);

  const clearHistory = useCallback(async () => {
    abortFlight();
    dispatch({ type: "clear" });
    if (scopeRef.current) await clearSavedHistory(scopeRef.current);
  }, [abortFlight]);

  return useMemo(
    () => ({
      messages: state.scope === scope ? state.messages : [],
      sending: state.sending,
      online: isOnline,
      scope,
      send,
      chooseOption,
      editAction,
      confirm,
      dismissAction,
      showLocal,
      cancel,
      startNewConversation,
      clearHistory,
    }),
    [state.scope, state.messages, state.sending, scope, isOnline, send, chooseOption, editAction, confirm, dismissAction, showLocal, cancel, startNewConversation, clearHistory],
  );
}
