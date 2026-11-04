/* One tiny signal so every open team surface re-reads after an assignment: the overview, a technician's list and the
   work-order screen each own their data, and none should have to know about the others. Carries no data. */

const listeners = new Set<() => void>();

export function onAssignmentChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitAssignmentChanged(): void {
  listeners.forEach((listener) => listener());
}

/* The same idea for a work-order change THIS phone just had the server confirm (report, claim, start, hold, resume,
   complete). The Homes already hear about every change through realtime, but realtime can lag or be disconnected, and
   the person who made the change should not wait for it. Carries no data, and only fires after the server answered. */

const mutationListeners = new Set<() => void>();

export function onWorkOrderMutated(listener: () => void): () => void {
  mutationListeners.add(listener);
  return () => {
    mutationListeners.delete(listener);
  };
}

export function emitWorkOrderMutated(): void {
  mutationListeners.forEach((listener) => listener());
}
