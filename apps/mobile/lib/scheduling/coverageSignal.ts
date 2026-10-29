/* A tiny "coverage changed" signal. The Find Coverage and Open Shifts screens sit on top of the Team Schedule, which
   stays mounted underneath; when they change a gap (offer, assign, waive, post) they emit, and the schedule re-reads
   coverage instead of showing a state the server has already moved past. */

type Listener = () => void;
const listeners = new Set<Listener>();

export function onCoverageChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitCoverageChanged(): void {
  for (const listener of [...listeners]) listener();
}
