import { useMemo } from "react";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { RoleHomeHeader, type HeaderStatus } from "@/components/home/RoleHomeHeader";
import { Notice } from "@/components/management/HomeParts";
import { firstNameOf } from "@/lib/housekeeping/homeText";
import { formatHotelTime, resolveTimeZone } from "@/lib/housekeeping/hotelTime";
import { greetingPart } from "@/lib/housekeeping/supervisorTodayView";
import { useHotelName } from "@/lib/housekeeping/useHotelName";
import { homeStatus, type HomeStatus, type SourceSnapshot } from "@/lib/management/homeStatus";
import { useAppStore } from "@/stores/appStore";

/** The Phase 6 Front Desk / GM Home header: property, greeting, hotel-local date, the real unread count and one honest
 *  freshness chip. Also returns the data-quality notice to render under it. Reads only; nothing here writes. */
export function useManagementHeader(prefix: string, name: string, sources: readonly SourceSnapshot[], onRefresh: () => void) {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const isOnline = useAppStore((s) => s.isOnline);
  const unreadCount = useAppStore((s) => s.unreadCount);
  const hotelTimezone = useAppStore((s) => s.hotelTimezone);
  const hotelName = useHotelName(true);
  const language = i18n.resolvedLanguage?.startsWith("es") ? "es" : "en";

  const status: HomeStatus = homeStatus(isOnline, sources);
  const now = Date.now();
  const first = firstNameOf(name);
  const part = greetingPart(hotelTimezone, new Date(now));
  const greeting = first ? t(`supervisorToday.greeting.${part}Name`, { name: first }) : t(`supervisorToday.greeting.${part}`);
  const dateLine = useMemo(
    () =>
      new Intl.DateTimeFormat(language === "es" ? "es-US" : "en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        timeZone: resolveTimeZone(hotelTimezone),
      }).format(new Date(now)),
    // The date only changes at midnight; recomputing per render of the minute is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [Math.floor(now / 60_000), language, hotelTimezone],
  );

  const clock = status.updatedAt ? formatHotelTime(new Date(status.updatedAt), hotelTimezone, language) : null;
  const chip: HeaderStatus = {
    live: { text: t("managementHome.status.live", { time: clock ?? "" }).trim(), tone: "ok", icon: "checkmark-circle-outline" },
    loading: { text: t("managementHome.status.loading"), tone: "muted", icon: "time-outline" },
    stale: { text: t("managementHome.status.stale", { time: clock ?? "" }).trim(), tone: "warn", icon: "alert-circle-outline" },
    partial: { text: t("managementHome.status.partial"), tone: "warn", icon: "alert-circle-outline" },
    failed: { text: t("managementHome.status.failed"), tone: "alert", icon: "alert-circle-outline" },
    offline: { text: t("managementHome.status.offline", { time: clock ?? "" }).trim(), tone: "warn", icon: "cloud-offline-outline" },
    offlineEmpty: { text: t("managementHome.status.offlineEmpty"), tone: "warn", icon: "cloud-offline-outline" },
  }[status.kind] as HeaderStatus;

  const header = (
    <RoleHomeHeader
      prefix={prefix}
      hotelName={hotelName}
      greeting={greeting}
      dateLine={dateLine}
      unreadCount={unreadCount}
      topInset={insets.top}
      t={t}
      status={chip}
      onPressStatus={onRefresh}
      statusActionLabel={t("managementHome.status.refresh")}
      onOpenNotifications={() => router.push("/(app)/notifications" as never)}
    />
  );

  const notice =
    status.kind === "offline" || status.kind === "offlineEmpty" ? (
      <Notice testID={`${prefix}-notice`} text={t(status.kind === "offline" ? "managementHome.notice.offline" : "managementHome.notice.offlineEmpty")} />
    ) : status.kind === "partial" ? (
      <Notice testID={`${prefix}-notice`} text={t("managementHome.notice.partial")} />
    ) : status.kind === "failed" ? (
      <Notice testID={`${prefix}-notice`} tone="alert" text={t("managementHome.notice.failed")} />
    ) : status.kind === "stale" ? (
      <Notice testID={`${prefix}-notice`} text={t("managementHome.notice.stale")} />
    ) : null;

  return { header, notice, status, language, hotelTimezone, isOnline };
}
