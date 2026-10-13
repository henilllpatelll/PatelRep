/**
 * A stand-in for the zustand `useAppStore` that screen tests can mock with. The real store is both a
 * hook (with optional selector) and an object with getState / setState / subscribe; the offline task
 * code reads it both ways, so a mock that is only a function is not enough.
 */
export function makeAppStoreMock<S extends Record<string, unknown>>(readState: () => S) {
  const hook = ((selector?: (state: S) => unknown) => (selector ? selector(readState()) : readState())) as {
    (): S;
    <T>(selector: (state: S) => T): T;
    getState: () => S;
    setState: (patch: Partial<S>) => void;
    subscribe: () => () => void;
  };
  hook.getState = readState;
  hook.setState = () => undefined;
  hook.subscribe = () => () => undefined;
  return hook;
}
