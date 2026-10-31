import type { AppNotification } from "@/lib/api/notifications";
import { formatShortDate } from "@/lib/scheduling/teamScheduleDates";

/* Schedule notifications are stored with English fallback text and an `i18n` key, so each phone renders them in the person's
   own language. The text only ever uses ids, dates and counts the server put in the payload: no leave reasons, call-out notes
   or manager comments exist in it to show. A notification without a key (or an unknown key) keeps its stored text. */

type Translate = (key: string, options?: Record<string, unknown>) => string;

export function isScheduleNotification(notification: Pick<AppNotification, "type" | "data">): boolean {
  return notification.type.startsWith("schedule_");
}

export function localizeNotification(notification: AppNotification, t: Translate, language?: string): AppNotification {
  if (!isScheduleNotification(notification)) return notification;
  const i18n = (notification.data as { i18n?: { key?: unknown; params?: unknown } } | null | undefined)?.i18n;
  const key = typeof i18n?.key === "string" && /^scheduleNotice\.[a-z_]+$/.test(i18n.key) ? i18n.key : null;
  if (!key) return notification;
  const raw = (i18n?.params && typeof i18n.params === "object" ? i18n.params : {}) as Record<string, unknown>;
  const firstDate = typeof raw.first_date === "string" ? raw.first_date : typeof raw.work_date === "string" ? raw.work_date : null;
  const params = {
    added: Number(raw.added ?? 0), changed: Number(raw.changed ?? 0), cancelled: Number(raw.cancelled ?? 0), removed: Number(raw.removed ?? 0),
    date: firstDate ? formatShortDate(firstDate.slice(0, 10), language) : "",
  };
  const bodyKey = firstDate && key === "scheduleNotice.published" ? `${key}.body` : key === "scheduleNotice.published" ? `${key}.bodyNoDate` : `${key}.body`;
  // A key this app version does not know comes back as the key itself: keep the stored text then.
  const titleKey = `${key}.title`;
  const title = t(titleKey, params);
  const body = t(bodyKey, params);
  return { ...notification, title: title === titleKey ? notification.title : title, body: body === bodyKey ? notification.body : body };
}
