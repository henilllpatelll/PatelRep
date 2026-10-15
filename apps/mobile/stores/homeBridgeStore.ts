import { create } from "zustand";
import type { HomeModel } from "@/lib/housekeeping/homeModel";

/**
 * The housekeeper Home owns the one HomeModel pipeline (rooms, sessions, shift,
 * sync, supervisor message). The Attention Center is a separate route, so Home
 * publishes its model here and the route reads it: no second fetch, no second
 * poll, and the two screens can never disagree. Cleared when Home unmounts.
 */

export type MarkReadResult = { ok: true } | { ok: false; reason: "offline" | "failed" };

interface HomeBridgeState {
  /** `tenant:user` the model belongs to. A reader for another scope must ignore it. */
  scope: string | null;
  model: HomeModel | null;
  refresh: (() => Promise<void>) | null;
  markNoteRead: (() => Promise<MarkReadResult>) | null;
  publish: (next: { scope: string | null; model: HomeModel; refresh: () => Promise<void>; markNoteRead: () => Promise<MarkReadResult> }) => void;
  clear: () => void;
}

export const useHomeBridge = create<HomeBridgeState>((set) => ({
  scope: null,
  model: null,
  refresh: null,
  markNoteRead: null,
  publish: (next) => set(next),
  clear: () => set({ scope: null, model: null, refresh: null, markNoteRead: null }),
}));
