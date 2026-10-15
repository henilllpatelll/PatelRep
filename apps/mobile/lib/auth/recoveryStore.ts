import { create } from "zustand";

/**
 * True between "a password-recovery link was exchanged for a session" and "the new password was saved
 * (or the person backed out)". While set, the (auth) layout does not send the person into the app, so
 * they can finish choosing a password. In memory only, on purpose.
 */
interface RecoveryState {
  pending: boolean;
  setPending: (pending: boolean) => void;
}

export const useRecoveryStore = create<RecoveryState>((set) => ({
  pending: false,
  setPending: (pending) => set({ pending }),
}));
