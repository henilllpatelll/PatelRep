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
