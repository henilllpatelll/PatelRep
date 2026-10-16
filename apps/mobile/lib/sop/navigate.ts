/**
 * Open an in-app route (a cited procedure, a related document). Used only when a surface did not hand in its own
 * navigation, e.g. the compact assistant, which closes itself first. The router is loaded when a link is pressed,
 * not when the component is imported, so cards that can show a link render anywhere (including in tests).
 */
export function pushHref(href: string): void {
  if (!href.startsWith("/(app)/")) return;
  const { router } = require("expo-router") as typeof import("expo-router");
  router.push(href as never);
}
