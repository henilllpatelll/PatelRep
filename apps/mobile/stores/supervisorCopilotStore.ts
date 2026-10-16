import { create } from "zustand";
import { onAssistantSessionReset } from "@/lib/ai/session";
import type { CopilotRoomContext } from "@/lib/ai/supervisorCopilot";

/**
 * What the supervisor Copilot was opened about, and the request to open it from somewhere else on screen
 * (e.g. an Attention detail sheet). It holds only ids the phone already verified on the board: the Copilot
 * re-checks the room against the current board every time it renders and the server re-verifies it again
 * before any message uses it. It belongs to one person + hotel and is emptied on sign-out or account switch.
 */
interface SupervisorCopilotState {
  scope: string | null;
  room: CopilotRoomContext | null;
  /** Bumped on every launch request; the app shell opens the card when it changes. */
  openNonce: number;
}

export const useSupervisorCopilotStore = create<SupervisorCopilotState>(() => ({ scope: null, room: null, openNonce: 0 }));

/** Ask the shell to open the Copilot, optionally about one verified room. */
export function launchSupervisorCopilot(scope: string | null, room: CopilotRoomContext | null): void {
  if (!scope) return;
  useSupervisorCopilotStore.setState((state) => ({ scope, room, openNonce: state.openNonce + 1 }));
}

export function clearSupervisorCopilotRoom(): void {
  useSupervisorCopilotStore.setState({ room: null });
}

/** The room context for `scope`, or null when the store holds another person's. */
export function roomContextFor(scope: string | null): CopilotRoomContext | null {
  const state = useSupervisorCopilotStore.getState();
  return scope !== null && state.scope === scope ? state.room : null;
}

onAssistantSessionReset(() => useSupervisorCopilotStore.setState({ scope: null, room: null }));
