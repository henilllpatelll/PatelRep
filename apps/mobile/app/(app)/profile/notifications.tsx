import type { ComponentProps } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsScreen } from "@/components/settings/SettingsScreen";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { canReceivePush, type PushPermissionState } from "@/lib/notifications/permissions";
import { useNotificationPreferences, type PreferenceItem } from "@/lib/notifications/useNotificationPreferences";
import { usePushPermission } from "@/lib/notifications/usePushPermission";
import { useTheme } from "@/lib/theme/useTheme";
import { useAppStore } from "@/stores/appStore";

const MAX_FONT_SCALE = 1.4;

type IconName = ComponentProps<typeof Ionicons>["name"];

/** The categories this build knows how to label. A newer server may list more; they are not shown. */
const CATEGORY_ICONS: Record<string, IconName> = {
  room_assignments: "bed-outline",
  work_orders: "construct-outline",
  tasks: "checkmark-circle-outline",
};

function permissionSubtitleKey(state: PushPermissionState | null): string | null {
  switch (state) {
    case "granted":
      return "settings.notifications.pushOn";
    case "provisional":
      return "settings.notifications.pushQuiet";
    case "undetermined":
      return "settings.notifications.pushNotRequested";
    case "denied":
      return "settings.notifications.pushDenied";
    case "unavailable":
      return "settings.notifications.pushUnavailable";
    default:
      return null;
  }
}

export default function NotificationSettingsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const user = useAppStore((state) => state.user);
  const isOnline = useAppStore((state) => state.isOnline);
  const unreadCount = useAppStore((state) => state.unreadCount);

  const role = user?.effective_role ?? user?.role;
  const scope = user?.tenant_id && user?.id ? `${user.tenant_id}:${user.id}` : null;
  const permission = usePushPermission(user?.id);
  const prefs = useNotificationPreferences({ scope, role, online: isOnline !== false });

  const items = prefs.items.filter((item) => item.key in CATEGORY_ICONS);
  const failed = items.filter((item) => item.failed);
  const saving = items.some((item) => item.saving);
  const offline = isOnline === false;
  const hasCritical = items.some((item) => item.has_critical);
  const receiving = permission.state !== null && canReceivePush(permission.state);
  const subtitleKey = permissionSubtitleKey(permission.state);

  const statusText = failed.length > 0
    ? t("settings.notifications.saveFailedDetail")
    : saving
      ? t("settings.notifications.saving")
      : prefs.justSaved
        ? t("settings.notifications.saved")
        : null;

  return (
    <SettingsScreen title={t("settings.notifications.title")} back>
      {offline ? (
        <Notice icon="cloud-offline-outline" text={t("settings.notifications.offline")} testID="notifications-offline" />
      ) : null}

      {/* Section 1: what THIS PHONE allows, read from the operating system. */}
      <SettingsSection title={t("settings.notifications.sectionPhone")}>
        <SettingsRow
          first
          icon={receiving ? "notifications-outline" : "notifications-off-outline"}
          label={t("settings.notifications.pushTitle")}
          subtitle={subtitleKey ? t(subtitleKey) : null}
          testID="row-push-status"
        />
        {permission.state === "undetermined" ? (
          <SettingsRow
            icon="notifications-circle-outline"
            label={t("settings.notifications.enable")}
            onPress={() => void permission.enable()}
            disabled={permission.busy}
            testID="row-push-enable"
          />
        ) : null}
        {permission.state === "denied" ? (
          <SettingsRow
            icon="settings-outline"
            label={t("settings.notifications.openSettings")}
            onPress={() => void permission.openSettings()}
            testID="row-push-open-settings"
          />
        ) : null}
      </SettingsSection>

      {/* Section 2: only the categories this role really receives, saved to the account. */}
      <SettingsSection title={t("settings.notifications.sectionWork")} testID="notifications-work">
        {prefs.status === "loading" ? (
          <View style={styles.loading} accessible accessibilityLabel={t("common.loading")} testID="notifications-loading">
            <ActivityIndicator color={theme.primaryAction} />
          </View>
        ) : null}
        {prefs.status === "error" ? (
          <View style={styles.errorBox} testID="notifications-load-error">
            <Text
              accessibilityRole="alert"
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              style={[styles.noticeText, { color: theme.textPrimary }]}
            >
              {t("settings.notifications.loadFailed")}
            </Text>
            <Pressable
              onPress={() => void prefs.reload()}
              accessibilityRole="button"
              accessibilityLabel={t("settings.notifications.retry")}
              style={[styles.retry, { borderColor: theme.border }]}
              testID="notifications-load-retry"
            >
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.retryText, { color: theme.primary }]}>
                {t("settings.notifications.retry")}
              </Text>
            </Pressable>
          </View>
        ) : null}
        {prefs.status === "ready"
          ? items.map((item, index) => (
              <CategoryRow
                key={item.key}
                item={item}
                first={index === 0}
                disabled={offline}
                onChange={(next) => prefs.setEnabled(item.key, next)}
              />
            ))
          : null}
      </SettingsSection>

      {prefs.fromCache ? <Notice icon="time-outline" text={t("settings.notifications.cachedNotice")} testID="notifications-cached" /> : null}

      {statusText ? (
        <View style={styles.statusRow} accessibilityLiveRegion="polite" testID="notifications-status">
          <Text
            accessibilityRole={failed.length > 0 ? "alert" : undefined}
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={[styles.statusText, { color: failed.length > 0 ? theme.status.dirty : theme.textMuted }]}
          >
            {statusText}
          </Text>
          {failed.length > 0 ? (
            <Pressable
              onPress={() => failed.forEach((item) => prefs.retry(item.key))}
              accessibilityRole="button"
              accessibilityLabel={t("settings.notifications.retry")}
              hitSlop={8}
              testID="notifications-retry"
            >
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.retryText, { color: theme.primary }]}>
                {t("settings.notifications.retry")}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {prefs.status === "ready" && !receiving && permission.state !== null && permission.state !== "unavailable" ? (
        <Notice icon="information-circle-outline" text={t("settings.notifications.phoneOffHint")} testID="notifications-phone-off" />
      ) : null}

      {/* Section 3: only behaviour the app can honestly point at - the phone owns sound and banners. */}
      <SettingsSection title={t("settings.notifications.sectionBehavior")}>
        {receiving ? (
          <SettingsRow
            first
            icon="volume-medium-outline"
            label={t("settings.notifications.deviceSettings")}
            subtitle={t("settings.notifications.deviceSettingsHint")}
            onPress={() => void permission.openSettings()}
            testID="row-device-settings"
          />
        ) : null}
        <View style={[styles.notes, receiving && { borderTopColor: theme.borderSubtle, borderTopWidth: StyleSheet.hairlineWidth }]}>
          {hasCritical ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.noteText, { color: theme.textSecondary }]} testID="notifications-critical">
              {t("settings.notifications.criticalHint")}
            </Text>
          ) : null}
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.noteText, { color: theme.textSecondary }]}>
            {t("settings.notifications.inboxOnlyNotice")}
          </Text>
        </View>
      </SettingsSection>

      {/* The inbox lives here for roles whose home screen has no bell; it is a separate screen. */}
      <SettingsSection title={t("settings.notifications.sectionInbox")}>
        <SettingsRow
          first
          icon="mail-unread-outline"
          label={t("settings.notifications.inbox")}
          subtitle={unreadCount > 0 ? t("profile.notificationsUnread", { count: unreadCount }) : null}
          onPress={() => router.push("/(app)/notifications")}
          testID="row-notification-inbox"
        />
      </SettingsSection>

      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={[styles.policy, { color: theme.textMuted }]}
        testID="notifications-policy"
      >
        {t("settings.notifications.policyNotice")}
      </Text>
    </SettingsScreen>
  );
}

function CategoryRow({
  item,
  first,
  disabled,
  onChange,
}: {
  item: PreferenceItem;
  first: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <SettingsRow
      first={first}
      icon={CATEGORY_ICONS[item.key]}
      label={t(`settings.notifications.categories.${item.key}.label`)}
      subtitle={t(`settings.notifications.categories.${item.key}.description`)}
      trailing={item.saving ? t("settings.notifications.saving") : null}
      switchValue={item.enabled}
      onSwitchChange={onChange}
      disabled={disabled}
      accessibilityHint={item.enabled ? t("settings.notifications.switchHintOff") : t("settings.notifications.switchHintOn")}
      testID={`row-notif-${item.key}`}
    />
  );
}

function Notice({ icon, text, testID }: { icon: IconName; text: string; testID: string }) {
  const theme = useTheme();
  return (
    <View
      style={[styles.notice, { backgroundColor: theme.surfaceMuted, borderColor: theme.borderSubtle }]}
      accessibilityRole="summary"
      testID={testID}
    >
      <Ionicons name={icon} size={20} color={theme.textMuted} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.noticeText, { color: theme.textSecondary }]}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { minHeight: 72, alignItems: "center", justifyContent: "center" },
  errorBox: { padding: 14, gap: 10 },
  retry: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center", paddingHorizontal: 14, borderWidth: 1, borderRadius: 12 },
  retryText: { fontSize: 14, fontWeight: "700" },
  statusRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingHorizontal: 4, minHeight: 24 },
  statusText: { flex: 1, fontSize: 13, lineHeight: 18 },
  notice: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 14, padding: 14 },
  noticeText: { flex: 1, fontSize: 14, lineHeight: 20 },
  notes: { paddingHorizontal: 14, paddingVertical: 12, gap: 8 },
  noteText: { fontSize: 13, lineHeight: 19 },
  policy: { fontSize: 12.5, lineHeight: 18, paddingHorizontal: 4 },
});
