/**
 * Supabase holds an internal auth lock while notifying onAuthStateChange
 * subscribers. Defer any follow-up Supabase or API calls until that callback
 * has returned so password sign-in can settle.
 */
export function deferAuthHydration(hydrate: () => Promise<void>): void {
  setTimeout(() => {
    void hydrate();
  }, 0);
}
