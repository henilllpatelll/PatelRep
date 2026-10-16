import { useAiCapability } from "@/lib/ai/capabilities";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { router, usePathname } from "expo-router";
import type { IntentHint } from "@/lib/ai/contract";
import { contextToIds, contextChanged, GENERAL_CONTEXT, normalizeLaunch, type ActiveContext, type AssistantLaunch } from "@/lib/ai/launch";
import { MAX_MESSAGE_CHARS, useAssistantConversation, type AssistantConversation } from "@/lib/ai/useAssistantConversation";

/* ─── One assistant for the whole app ───────────────────────────────────────
   The compact sheet and the full-screen chat are two views of THIS provider: one
   conversation controller, one composer draft, one context. Neither surface keeps
   a copy of the messages or talks to the network itself, so opening the full
   assistant continues exactly where the sheet was, and closing and reopening
   either one starts nothing new. Mounted once in the signed-in layout; the
   conversation drops itself the moment the person or hotel changes. */

/** Which panel the compact sheet is showing. */
export type SheetView = "home" | "voice" | "rooms" | "confirm";

export interface ConfirmTarget {
  messageId: string;
  actionId: string;
}

export interface AssistantApi {
  conversation: AssistantConversation;
  context: ActiveContext;
  /** What the assistant is about right now, with the server-verified room number once a reply confirmed it. */
  contextLabel: { text: string | null; verified: boolean };
  clearContext: () => void;
  /** The one text box shared by the sheet and the full chat. */
  draft: string;
  setDraft: (text: string) => void;
  /** An intent a quick action pointed the next message at (the server still checks it against the person's role). */
  pendingHint: IntentHint | undefined;
  setPendingHint: (hint: IntentHint | undefined) => void;
  /** Send what is in the composer, once. Clears the box and the hint. */
  sendDraft: () => void;
  /** Bumps whenever something asks the composer to take focus. */
  focusToken: number;
  requestFocus: () => void;
  sheetOpen: boolean;
  sheetView: SheetView;
  setSheetView: (view: SheetView) => void;
  confirmTarget: ConfirmTarget | null;
  openConfirm: (target: ConfirmTarget) => void;
  /** Point the assistant at something (or reset it) without opening the sheet. A different subject starts a new conversation. */
  launchContext: (launch: AssistantLaunch) => void;
  /** The one entry point every screen uses to open the assistant, optionally about something. */
  openAssistant: (launch?: AssistantLaunch) => void;
  closeAssistant: () => void;
  /** Continue in the full-screen assistant (same conversation). */
  expandAssistant: () => void;
  /** Cancel the question still waiting for an answer and give its text back to the composer. */
  cancelSend: () => void;
  /** A fresh conversation: forgets the messages, the saved copy and any context. */
  startFresh: () => void;
}

const AssistantContext = createContext<AssistantApi | null>(null);

export function useAssistant(): AssistantApi {
  const api = useContext(AssistantContext);
  if (!api) throw new Error("useAssistant must be used inside <AssistantProvider>.");
  return api;
}

/** For screens that offer the assistant but must keep working without it (tests, or a layout without the provider). */
export function useAssistantOptional(): AssistantApi | null {
  const api = useContext(AssistantContext);
  // An operator can switch the assistant off per hotel: every "Ask the assistant" entry point (they all use
  // this hook) then disappears together, and the screens keep working without it.
  const enabled = useAiCapability("unifiedAssistant");
  return enabled ? api : null;
}

const COPILOT_ROUTE = /^\/copilot(\/|$)/;

export function AssistantProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [context, setContext] = useState<ActiveContext>(GENERAL_CONTEXT);
  const contextRef = useRef(context);
  contextRef.current = context;
  const [draft, setDraftState] = useState("");
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [pendingHint, setPendingHint] = useState<IntentHint | undefined>(undefined);
  const pendingHintRef = useRef(pendingHint);
  pendingHintRef.current = pendingHint;
  const [focusToken, setFocusToken] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetView, setSheetView] = useState<SheetView>("home");
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null);

  const ids = useMemo(() => contextToIds(context), [context]);
  // Saved (text only) so a restart keeps the day's conversation; it is cleared with "Clear saved conversation".
  const conversation = useAssistantConversation({ persist: true, context: ids });
  const conversationRef = useRef(conversation);
  conversationRef.current = conversation;
  const scope = conversation.scope;

  const setDraft = useCallback((text: string) => setDraftState(text.slice(0, MAX_MESSAGE_CHARS)), []);
  const requestFocus = useCallback(() => setFocusToken((value) => value + 1), []);

  // A different person or hotel never inherits the last person's subject, draft or open sheet.
  // (Not on first mount: a screen below may already have pointed the assistant at something.)
  const lastScope = useRef(scope);
  useEffect(() => {
    if (lastScope.current === scope) return;
    lastScope.current = scope;
    setContext(GENERAL_CONTEXT);
    setDraftState("");
    setPendingHint(undefined);
    setSheetOpen(false);
    setSheetView("home");
    setConfirmTarget(null);
  }, [scope]);

  // A subject belongs to the screen that set it: once the person has left that screen (and is not in the
  // full assistant, which continues it), the next conversation is about nothing in particular.
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  const originRef = useRef<string | null>(null);
  useEffect(() => {
    if (sheetOpen || COPILOT_ROUTE.test(pathname) || pathname === originRef.current) return;
    setContext((current) => (current.key === GENERAL_CONTEXT.key ? current : GENERAL_CONTEXT));
  }, [pathname, sheetOpen]);

  const launchContext = useCallback((launch: AssistantLaunch) => {
    const next = normalizeLaunch(launch);
    originRef.current = pathRef.current;
    if (contextChanged(contextRef.current, next)) {
      // A new subject is a new conversation: the old room/task never leaks into it.
      if (conversationRef.current.messages.length > 0) conversationRef.current.startNewConversation();
      setContext(next);
    }
    if (launch.prefill) setDraftState(launch.prefill.slice(0, MAX_MESSAGE_CHARS));
  }, []);

  const openAssistant = useCallback(
    (launch?: AssistantLaunch) => {
      if (launch) launchContext(launch);
      setConfirmTarget(null);
      setSheetView(launch?.voice ? "voice" : "home");
      setSheetOpen(true);
    },
    [launchContext],
  );

  const closeAssistant = useCallback(() => {
    setSheetOpen(false);
    setSheetView("home");
    setConfirmTarget(null);
  }, []);

  const expandAssistant = useCallback(() => {
    setSheetOpen(false);
    setSheetView("home");
    setConfirmTarget(null);
    router.push("/(app)/copilot");
  }, []);

  const sendDraft = useCallback(() => {
    const text = draftRef.current.trim();
    if (!text) return;
    const hint = pendingHintRef.current;
    setDraftState("");
    setPendingHint(undefined);
    void conversationRef.current.send(text, hint ? { intentHint: hint } : undefined);
  }, []);

  const clearContext = useCallback(() => setContext(GENERAL_CONTEXT), []);

  const openConfirm = useCallback((target: ConfirmTarget) => {
    setConfirmTarget(target);
    setSheetView("confirm");
  }, []);

  const cancelSend = useCallback(() => {
    const text = conversationRef.current.cancel();
    if (text) setDraftState(text.slice(0, MAX_MESSAGE_CHARS));
  }, []);

  const startFresh = useCallback(() => {
    conversationRef.current.startNewConversation();
    setContext(GENERAL_CONTEXT);
    setDraftState("");
    setPendingHint(undefined);
    setConfirmTarget(null);
  }, []);

  const contextLabel = useMemo(() => {
    if (!context.entityId) return { text: null, verified: false };
    // The room number the SERVER confirmed for this id beats whatever label the launcher supplied.
    for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
      const trusted = conversation.messages[index]?.trusted;
      if (trusted?.roomId && trusted.roomId === context.entityId && trusted.roomNumber) {
        return { text: trusted.roomNumber, verified: true };
      }
      // The procedure's own title, as the server found it for this id, beats the label the launcher supplied.
      if (trusted?.documentId && trusted.documentId === context.entityId && trusted.documentTitle) {
        return { text: trusted.documentTitle, verified: true };
      }
    }
    return { text: context.label, verified: false };
  }, [context, conversation.messages]);

  const value = useMemo<AssistantApi>(
    () => ({
      conversation,
      context,
      contextLabel,
      clearContext,
      draft,
      setDraft,
      pendingHint,
      setPendingHint,
      sendDraft,
      focusToken,
      requestFocus,
      sheetOpen,
      sheetView,
      setSheetView,
      confirmTarget,
      openConfirm,
      launchContext,
      openAssistant,
      closeAssistant,
      expandAssistant,
      cancelSend,
      startFresh,
    }),
    [
      conversation,
      context,
      contextLabel,
      clearContext,
      draft,
      setDraft,
      pendingHint,
      sendDraft,
      focusToken,
      requestFocus,
      sheetOpen,
      sheetView,
      confirmTarget,
      openConfirm,
      launchContext,
      openAssistant,
      closeAssistant,
      expandAssistant,
      cancelSend,
      startFresh,
    ],
  );

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}
