
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

/** Engineering roles share one help set; the server decides what each may do. */
export const ENGINEERING_ROLES = ["engineer", "chief_engineer"] as const;
export const isEngineeringRole = (role: string | null | undefined): boolean => !!role && (ENGINEERING_ROLES as readonly string[]).includes(role);

/** Where the Engineering Sync Center lives (Phase 3); everyone else keeps the Settings sync screen. */
export const ENGINEERING_SYNC_ROUTE = "/(app)/engineering-sync";

export const ENGINEERING_TOPICS = ["workOrders", "pm", "roomsAssets", "offlineSync", "account"] as const;
export type EngineeringTopic = (typeof ENGINEERING_TOPICS)[number];
export const isEngineeringTopic = (value: unknown): value is EngineeringTopic =>
  typeof value === "string" && (ENGINEERING_TOPICS as readonly string[]).includes(value);

export type FaqAction =
  | { kind: "route"; route: string; labelKey: string }
  | { kind: "contact"; labelKey: string };

export interface FaqItem {
  id: string;
  /** Everyone when omitted. */
  roles?: readonly string[];
  action?: FaqAction;
  /** Engineering grouping. Other roles ignore it and keep one flat list. */
  topic?: EngineeringTopic;
}

const openSync: FaqAction = { kind: "route", route: SUPPORT_ROUTES.sync, labelKey: "help.faq.actions.sync" };
const openReport: FaqAction = { kind: "route", route: SUPPORT_ROUTES.report, labelKey: "help.faq.actions.report" };

export const GENERAL_FAQS: readonly FaqItem[] = [
  { id: "assignmentsMissing", action: openReport },
  { id: "refreshWork" },
  { id: "useOffline", topic: "offlineSync", action: openSync },
  { id: "syncChanges", topic: "offlineSync", action: openSync },
  { id: "taskPending", topic: "offlineSync", action: openSync },
  { id: "changeLanguage", topic: "account", action: { kind: "route", route: SUPPORT_ROUTES.language, labelKey: "help.faq.actions.language" } },
  { id: "darkMode", topic: "account", action: { kind: "route", route: SUPPORT_ROUTES.appearance, labelKey: "help.faq.actions.appearance" } },
  { id: "forgotPassword", topic: "account", action: { kind: "route", route: SUPPORT_ROUTES.security, labelKey: "help.faq.actions.security" } },
  { id: "noAccess", topic: "workOrders", action: { kind: "contact", labelKey: "help.faq.actions.contact" } },
  { id: "contactSupervisor", topic: "account", action: { kind: "contact", labelKey: "help.faq.actions.contact" } },
  { id: "signOutUnsynced", topic: "offlineSync", action: openSync },
];

const openWork: FaqAction = { kind: "route", route: "/(app)/work-orders", labelKey: "help.faq.actions.work" };
const openPm: FaqAction = { kind: "route", route: "/(app)/pm-schedules", labelKey: "help.faq.actions.pm" };
const openAssets: FaqAction = { kind: "route", route: "/(app)/assets", labelKey: "help.faq.actions.assets" };
const openRooms: FaqAction = { kind: "route", route: "/(app)/room-status", labelKey: "help.faq.actions.rooms" };
const openNewIssue: FaqAction = { kind: "route", route: "/(app)/work-orders/new", labelKey: "help.faq.actions.reportIssue" };
const openNotifications: FaqAction = { kind: "route", route: SUPPORT_ROUTES.notifications, labelKey: "help.faq.actions.notifications" };
const openProfile: FaqAction = { kind: "route", route: "/(app)/profile/personal", labelKey: "help.faq.actions.profile" };
const E = ["engineer", "chief_engineer"] as const;

/** Engineering-only questions. Each answer is written against behaviour that exists in the app today. */
export const ENGINEERING_FAQS: readonly FaqItem[] = [
  { id: "engFindWork", roles: E, topic: "workOrders", action: openWork },
  { id: "engUpdateWork", roles: E, topic: "workOrders", action: openWork },
  { id: "engExtraIssue", roles: E, topic: "workOrders", action: openNewIssue },
  { id: "engActionUnavailable", roles: E, topic: "workOrders", action: openSync },
  { id: "engAssignRoles", roles: E, topic: "workOrders" },
  { id: "engPmFind", roles: E, topic: "pm", action: openPm },
  { id: "engPmOpen", roles: E, topic: "pm", action: openPm },
  { id: "engPmDraft", roles: E, topic: "pm", action: openSync },
  { id: "engPmFailed", roles: E, topic: "pm", action: openSync },
  { id: "engFindRoom", roles: E, topic: "roomsAssets", action: openRooms },
  { id: "engRoomDetails", roles: E, topic: "roomsAssets", action: openRooms },
  { id: "engScanAsset", roles: E, topic: "roomsAssets", action: openAssets },
  { id: "engEquipmentProblem", roles: E, topic: "roomsAssets", action: openNewIssue },
  { id: "engOffline", roles: E, topic: "offlineSync", action: openSync },
  { id: "engLocalChanges", roles: E, topic: "offlineSync", action: openSync },
  { id: "engRetrySync", roles: E, topic: "offlineSync", action: openSync },
  { id: "engConflict", roles: E, topic: "offlineSync", action: openSync },
  { id: "engSignOutFirst", roles: E, topic: "offlineSync", action: openSync },
  { id: "engNotifPrefs", roles: E, topic: "account", action: openNotifications },
  { id: "engPreferredName", roles: E, topic: "account", action: openProfile },
  { id: "engSecurity", roles: E, topic: "account", action: { kind: "route", route: SUPPORT_ROUTES.security, labelKey: "help.faq.actions.security" } },
];

export const ROLE_FAQS: readonly FaqItem[] = [
  { id: "hkReclean", roles: ["housekeeper"] },
  { id: "hkSessionSync", roles: ["housekeeper"], action: openSync },
  { id: "inspMissing", roles: ["inspector"], action: { kind: "contact", labelKey: "help.faq.actions.contact" } },
  { id: "inspSubmit", roles: ["inspector"], action: openReport },
  { id: "engWorkOrders", roles: ["engineer", "chief_engineer"], topic: "workOrders" },
  { id: "engUpdates", roles: ["engineer", "chief_engineer"], topic: "offlineSync", action: openSync },
  { id: "supVisibility", roles: ["housekeeping_supervisor"] },
  { id: "supTeam", roles: ["housekeeping_supervisor"] },
  { id: "fdGuestRequests", roles: ["front_desk"] },
  { id: "fdRoomStatus", roles: ["front_desk"], action: openReport },
  { id: "gmAccess", roles: ["gm"] },
  { id: "gmAdmin", roles: ["gm"] },
];

/** Sync questions open the Sync Center for engineering roles, the Settings sync screen for everyone else. */
export function resolveFaqAction(action: FaqAction | undefined, role: string | null | undefined): FaqAction | undefined {
  if (action?.kind === "route" && action.route === SUPPORT_ROUTES.sync && isEngineeringRole(role)) return { ...action, route: ENGINEERING_SYNC_ROUTE };
  return action;
}

/** Role questions first (they are the most specific), then the general ones. */
export function faqsForRole(role: string | null | undefined): FaqItem[] {
  const specific = ROLE_FAQS.filter((item) => role && item.roles?.includes(role));
  // Engineering gets its dedicated questions ahead of the older role questions (kept, so their text and ids still work).
  const dedicated = isEngineeringRole(role) ? ENGINEERING_FAQS : [];
  return [...dedicated, ...specific, ...GENERAL_FAQS];
}

export interface FaqTopicGroup {
  topic: EngineeringTopic;
  items: FaqItem[];
}

/** Engineering questions grouped by topic, in a fixed order. Empty topics are dropped, so no topic page is ever empty. */
export function faqTopicsForRole(role: string | null | undefined): FaqTopicGroup[] {
  if (!isEngineeringRole(role)) return [];
  const items = faqsForRole(role);
  return ENGINEERING_TOPICS.map((topic) => ({ topic, items: items.filter((item) => item.topic === topic) })).filter((group) => group.items.length > 0);
}
