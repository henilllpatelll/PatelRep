import { router } from "expo-router";
import { isSupervisorSafePath, type SupervisorHref } from "@/lib/navigation/supervisorRoutes";

/** Open a supervisor destination. Refuses anything that is not a registered supervisor route. */
export function openSupervisorHref(href: SupervisorHref): boolean {
  if (!isSupervisorSafePath(href.pathname)) return false;
  router.push((href.params ? { pathname: href.pathname, params: href.params } : href.pathname) as never);
  return true;
}
