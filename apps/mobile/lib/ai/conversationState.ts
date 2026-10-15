import type { AssistantSource, ClarifyOption, CopilotFailureKind, CopilotOutcome, Provenance } from "@/lib/ai/contract";
import { patchPreview, type ActionPreview, type DraftPatch } from "@/lib/ai/drafts";
import type { PersistableMessage, StoredMessage } from "@/lib/ai/history";

/* ─── The assistant conversation as plain state ─────────────────────────────
   A pure reducer (no storage, no network) so the rules that matter -- whose
   conversation this is, what survives a switch of person, what an action's
   status can become -- are testable without rendering anything. */

export type ActionStatus = "ready" | "confirming" | "confirmed" | "failed" | "dismissed";

export interface ActionItem {
  id: string;
  preview: ActionPreview;
  status: ActionStatus;
  /** Stable for this preview, so a retried confirm cannot create a second record. */
  requestKey: string;
  failure: CopilotFailureKind | null;
  failureMessage: string | null;
  /** The server returned an earlier identical record instead of creating a new one. */
  deduplicated: boolean;
}

export interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** ms epoch */
  at: number;
  /** What the reply was: an answer, proposed actions, a question back, something this app can't act on, or a notice. */
  kind?: CopilotOutcome["kind"] | "notice";
  provenance?: Provenance;
  sources?: AssistantSource[];
  options?: ClarifyOption[];
  actions?: ActionItem[];
  /** For a notice: why nothing happened. */
  notice?: CopilotFailureKind;
  /** The person's own words that led to this reply (re-sent with an intent hint after a clarification). */
  askedText?: string;
}

export interface ConversationState {
  /** `${tenantId}:${userId}`; null while signed out. A conversation never outlives its scope. */
  scope: string | null;
  messages: AssistantMessage[];
  sending: boolean;
  /** Saved history for this scope has been read (or there is none to read). */
  hydrated: boolean;
}

export const initialConversation = (scope: string | null = null): ConversationState => ({
  scope,
  messages: [],
  sending: false,
  hydrated: false,
});

export type ConversationAction =
  /** Signed-in person or hotel changed (or signed out): drop everything. */
  | { type: "scope"; scope: string | null }
  | { type: "hydrate"; scope: string; stored: StoredMessage[] }
  | { type: "sent"; message: AssistantMessage }
  | { type: "replied"; message: AssistantMessage }
  | { type: "action"; messageId: string; actionId: string; patch: Partial<ActionItem> }
  | { type: "edit"; messageId: string; actionId: string; patch: DraftPatch }
  | { type: "clear" };

function mapAction(
  state: ConversationState,
  messageId: string,
  actionId: string,
  update: (item: ActionItem) => ActionItem,
): ConversationState {
  return {
    ...state,
    messages: state.messages.map((message) =>
      message.id === messageId && message.actions
        ? { ...message, actions: message.actions.map((item) => (item.id === actionId ? update(item) : item)) }
        : message,
    ),
  };
}

export function conversationReducer(state: ConversationState, action: ConversationAction): ConversationState {
  switch (action.type) {
    case "scope":
      return state.scope === action.scope ? state : initialConversation(action.scope);
    case "hydrate":
      // Late answers for a conversation that is no longer the open one are ignored.
      if (state.scope !== action.scope || state.hydrated) return state;
      return {
        ...state,
        hydrated: true,
        // Anything already said in this session stays after the saved lines.
        messages: [
          ...action.stored.map<AssistantMessage>((m) => ({ id: m.id, role: m.role, content: m.content, at: m.at })),
          ...state.messages,
        ],
      };
    case "sent":
      return { ...state, sending: true, messages: [...state.messages, action.message] };
    case "replied":
      return { ...state, sending: false, messages: [...state.messages, action.message] };
    case "action":
      return mapAction(state, action.messageId, action.actionId, (item) => ({ ...item, ...action.patch }));
    case "edit":
      return mapAction(state, action.messageId, action.actionId, (item) =>
        // A preview that is already being created, or was, can no longer be edited.
        item.status === "confirming" || item.status === "confirmed"
          ? item
          : { ...item, preview: patchPreview(item.preview, action.patch), status: "ready", failure: null, failureMessage: null },
      );
    case "clear":
      return { ...initialConversation(state.scope), hydrated: true };
  }
}

/** What may be saved: text only, flagged so storage can leave out what it must not keep. */
export function toPersistable(messages: AssistantMessage[]): PersistableMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    at: message.at,
    notice: message.kind === "notice",
    proposedGuestRequest: message.actions?.some((item) => item.preview.kind === "guest_request") ?? false,
  }));
}
