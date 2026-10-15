/**
 * A tiny cache for deliberate, paid AI requests (shift briefing, shift recap).
 * Two promises: the same key is never requested twice at once, and a recent
 * answer is reused instead of spending another credit. Only an explicit
 * `force` (the person tapping "New briefing") skips the stored answer.
 */

export interface AiCache<T> {
  /** The stored answer for this key, if it is still fresh. */
  get: (key: string) => T | null;
  /** True while a request for this key is on its way. */
  pending: (key: string) => boolean;
  /** Fresh answer, or the request already in flight, or a new request. */
  run: (key: string, fetcher: () => Promise<T>, options?: { force?: boolean }) => Promise<T>;
  clear: () => void;
}

export function createAiCache<T>(ttlMs: number, now: () => number = Date.now): AiCache<T> {
  const stored = new Map<string, { value: T; at: number }>();
  const inFlight = new Map<string, Promise<T>>();

  const get = (key: string): T | null => {
    const hit = stored.get(key);
    if (!hit) return null;
    if (now() - hit.at > ttlMs) {
      stored.delete(key);
      return null;
    }
    return hit.value;
  };

  return {
    get,
    pending: (key) => inFlight.has(key),
    run: (key, fetcher, options) => {
      const running = inFlight.get(key);
      if (running) return running;
      if (!options?.force) {
        const hit = get(key);
        if (hit !== null) return Promise.resolve(hit);
      }
      const request = fetcher()
        .then((value) => {
          stored.set(key, { value, at: now() });
          return value;
        })
        .finally(() => {
          inFlight.delete(key);
        });
      inFlight.set(key, request);
      return request;
    },
    clear: () => {
      stored.clear();
      inFlight.clear();
    },
  };
}
