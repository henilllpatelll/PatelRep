
/**
 * One FAQ registry for every role. Text lives in the locale files under `help.faq.items.<id>.{q,a}` (English and
 * Spanish side by side), so adding a question is: add an entry here plus its two strings. Answers describe what the
 * app really does today; offline claims in particular are limited to the work that is actually saved on the phone.
 */

export const SUPPORT_ROUTES = {
  sync: "/(app)/profile/sync",
  language: "/(app)/profile/language",
  appearance: "/(app)/profile/appearance",
  security: "/(app)/profile/security",
  notifications: "/(app)/profile/notifications",
  report: "/(app)/profile/report",
  diagnostics: "/(app)/profile/diagnostics",
  myReports: "/(app)/profile/my-reports",
  faq: "/(app)/profile/faq",
  help: "/(app)/profile/help",
} as const;

export type FaqAction =
  | { kind: "route"; route: string; labelKey: string }
  | { kind: "contact"; labelKey: string };

export interface FaqItem {
  id: string;
  /** Everyone when omitted. */
  roles?: readonly string[];
  action?: FaqAction;
}

const openSync: FaqAction = { kind: "route", route: SUPPORT_ROUTES.sync, labelKey: "help.faq.actions.sync" };
const openReport: FaqAction = { kind: "route", route: SUPPORT_ROUTES.report, labelKey: "help.faq.actions.report" };

export const GENERAL_FAQS: readonly FaqItem[] = [
  { id: "assignmentsMissing", action: openReport },
  { id: "refreshWork" },
  { id: "useOffline", action: openSync },
  { id: "syncChanges", action: openSync },
  { id: "taskPending", action: openSync },
  { id: "changeLanguage", action: { kind: "route", route: SUPPORT_ROUTES.language, labelKey: "help.faq.actions.language" } },
  { id: "darkMode", action: { kind: "route", route: SUPPORT_ROUTES.appearance, labelKey: "help.faq.actions.appearance" } },
  { id: "forgotPassword", action: { kind: "route", route: SUPPORT_ROUTES.security, labelKey: "help.faq.actions.security" } },
  { id: "noAccess", action: { kind: "contact", labelKey: "help.faq.actions.contact" } },
  { id: "contactSupervisor", action: { kind: "contact", labelKey: "help.faq.actions.contact" } },
  { id: "signOutUnsynced", action: openSync },
];

export const ROLE_FAQS: readonly FaqItem[] = [
  { id: "hkReclean", roles: ["housekeeper"] },
  { id: "hkSessionSync", roles: ["housekeeper"], action: openSync },
  { id: "inspMissing", roles: ["inspector"], action: { kind: "contact", labelKey: "help.faq.actions.contact" } },
  { id: "inspSubmit", roles: ["inspector"], action: openReport },
  { id: "engWorkOrders", roles: ["engineer", "chief_engineer"] },
  { id: "engUpdates", roles: ["engineer", "chief_engineer"], action: openSync },
  { id: "supVisibility", roles: ["housekeeping_supervisor"] },
  { id: "supTeam", roles: ["housekeeping_supervisor"] },
  { id: "fdGuestRequests", roles: ["front_desk"] },
  { id: "fdRoomStatus", roles: ["front_desk"], action: openReport },
  { id: "gmAccess", roles: ["gm"] },
  { id: "gmAdmin", roles: ["gm"] },
];

/** Role questions first (they are the most specific), then the general ones. */
export function faqsForRole(role: string | null | undefined): FaqItem[] {
  const specific = ROLE_FAQS.filter((item) => role && item.roles?.includes(role));
  return [...specific, ...GENERAL_FAQS];
}
