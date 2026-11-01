/* ─── Offline claims the server refused ─────────────────────────────────────
   A claim made offline is only *queued*. When it replays and the server says no (someone else got there first,
   the order is gone, the role was refused) it can never succeed, so the sync drops it and records it here. The
   Work tab lists these until the person dismisses them, so a refused claim is never silent. Stored per signed-in
   person on this phone; holds a WO label and a reason code, never typed content. */

import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getQueueOwner } from "@/lib/offline/queueOwner";

export type ClaimConflictReason = "conflict" | "forbidden" | "not_found";

export interface ClaimConflict {
  woId: string;
  /** "WO-1042 · AC not cooling" captured when the claim was queued, if known. */
  label: string | null;
  reason: ClaimConflictReason;
  at: string;
}

const MAX_CONFLICTS = 20;
const storageKey = (owner: string) => `engineering.claimConflicts.v1:${owner}`;

let loadedFor: string | null = null;
let items: ClaimConflict[] = [];
const listeners = new Set<(next: ClaimConflict[]) => void>();

function publish(): void {
  const snapshot = [...items];
  listeners.forEach((listener) => listener(snapshot));
}

async function persist(owner: string): Promise<void> {
  try {
    await AsyncStorage.setItem(storageKey(owner), JSON.stringify(items));
  } catch {
    // The in-memory list still serves this session.
  }
}

/** Reads the signed-in person's saved conflicts (and drops any held for a previous account). */
export async function loadClaimConflicts(): Promise<ClaimConflict[]> {
  const owner = getQueueOwner();
  if (!owner) {
    loadedFor = null;
    items = [];
    publish();
    return [];
  }
  if (loadedFor !== owner) {
    loadedFor = owner;
    items = [];
    try {
      const raw = await AsyncStorage.getItem(storageKey(owner));
      const parsed = raw ? (JSON.parse(raw) as ClaimConflict[]) : [];
      if (getQueueOwner() === owner && Array.isArray(parsed)) items = parsed.slice(0, MAX_CONFLICTS);
    } catch {
      items = [];
    }
    publish();
  }
  return [...items];
}

export async function recordClaimConflict(conflict: Omit<ClaimConflict, "at">): Promise<void> {
  const owner = getQueueOwner();
  if (!owner) return;
  await loadClaimConflicts();
  items = [{ ...conflict, at: new Date().toISOString() }, ...items.filter((c) => c.woId !== conflict.woId)].slice(0, MAX_CONFLICTS);
  publish();
  await persist(owner);
}

export async function dismissClaimConflict(woId: string): Promise<void> {
  const owner = getQueueOwner();
  if (!owner) return;
  items = items.filter((c) => c.woId !== woId);
  publish();
  await persist(owner);
}

/** The signed-in person's refused offline claims, live. `scope` re-reads when the account changes. */
export function useClaimConflicts(scope: string | null | undefined): ClaimConflict[] {
  const [list, setList] = useState<ClaimConflict[]>([]);
  useEffect(() => {
    let active = true;
    const listener = (next: ClaimConflict[]) => {
      if (active) setList(next);
    };
    listeners.add(listener);
    void loadClaimConflicts().then((loaded) => {
      if (active) setList(loaded);
    });
    return () => {
      active = false;
      listeners.delete(listener);
    };
  }, [scope]);
  return list;
}

/** Test seam. */
export function resetClaimConflictsForTests(): void {
  loadedFor = null;
  items = [];
  listeners.clear();
}
