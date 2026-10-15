import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { NotConfiguredNotice } from "@/components/settings/NotConfiguredNotice";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsScreen } from "@/components/settings/SettingsScreen";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { useAppStore } from "@/stores/appStore";

export default function NotificationSettingsScreen() {
  const { t } = useTranslation();
  const { unreadCount } = useAppStore();
  return (
    <SettingsScreen title={t("settings.notifications.title")} back>
      <NotConfiguredNotice />
      {/* The existing inbox stays reachable from here until the notification phase. */}
      <SettingsSection>
        <SettingsRow
          first
          icon="mail-unread-outline"
          label={t("settings.notifications.inbox")}
          subtitle={unreadCount > 0 ? t("profile.notificationsUnread", { count: unreadCount }) : null}
          onPress={() => router.push("/(app)/notifications")}
          testID="row-notification-inbox"
        />
      </SettingsSection>
    </SettingsScreen>
  );
}
