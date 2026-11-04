import { useCallback, useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Redirect, router, useFocusEffect } from "expo-router";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppStore } from "@/stores/appStore";
import { MoreHeader } from "@/components/engineering/more/MoreHeader";
import { MoreIdentityCard } from "@/components/engineering/more/MoreIdentityCard";
import { SignOutSheet } from "@/components/security/SignOutSheet";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { getEngineeringMoreHub, isMoreItemAvailable, type MoreItem } from "@/lib/engineering/moreMenu";
import { isEngineeringRole } from "@/lib/engineering/roles";
import { useEngineeringSyncSummary } from "@/lib/engineering/useEngineeringSyncSummary";
import { usePmSyncItems } from "@/lib/engineering/usePmSyncItems";
import { buildMoreSyncStatus, type SyncTone } from "@/lib/engineering/syncStatusModel";
import { useOwnProfile } from "@/lib/settings/useOwnProfile";
import { useSettingsIdentity } from "@/lib/settings/useSettingsIdentity";
import { useTheme } from "@/lib/theme/useTheme";

/** Engineering More hub: identity + sync, then the secondary tools, account/support and sign out. */
export default function EngineeringMoreScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const role = useAppStore((s) => s.user?.effective_role ?? s.user?.role);
  const unreadCount = useAppStore((s) => s.unreadCount);
  const isOnline = useAppStore((s) => s.isOnline);
  // The same engineering queues the Home header and the Sync Center read, so the three can never disagree.
  const pm = usePmSyncItems();
  const sync = useEngineeringSyncSummary(pm);
  const { user, name, hotelName } = useSettingsIdentity();
  // Refreshes the short-lived photo URL; the screen never waits on it.
  const { profile } = useOwnProfile();
  const [signOutOpen, setSignOutOpen] = useState(false);

  // Tabs stay mounted: re-read the queues each time More comes into view (no polling; hooks also react to connection/sync).
  const { refresh: refreshSync } = sync;
  useFocusEffect(
    useCallback(() => {
      void refreshSync();
    }, [refreshSync]),
  );
  const status = useMemo(
    () => buildMoreSyncStatus({ online: isOnline !== false, sending: sync.sending, counts: { waiting: sync.waiting, attention: sync.attention, verified: sync.verified } }),
    [isOnline, sync.sending, sync.waiting, sync.attention, sync.verified],
  );
  const toneColor: Record<SyncTone, string> = { success: theme.status.ready, neutral: theme.textMuted, warning: theme.status.pickup, danger: theme.status.dirty };

  // The route exists for every role (tabs are declared once); only engineering roles have a More tab.
  if (!isEngineeringRole(role)) return <Redirect href="/(app)/home" />;

  const hub = getEngineeringMoreHub(role);
  const find = (items: MoreItem[], key: string) => items.find((i) => i.key === key);
  const bell = find(hub.header, "notifications");
  const headerSettings = find(hub.header, "settings");
  const profileItem = find(hub.identity, "profile");
  const syncItem = find(hub.identity, "sync");
  const signOut = hub.signOut[0];

  function go(item: MoreItem | undefined) {
    // Re-check at press time: hiding a row is never the only guard (the API still enforces every permission).
    if (!item || !isMoreItemAvailable(role, item.key)) return;
    if (item.action === "signOut") setSignOutOpen(true);
    else if (item.href) router.push(item.href as never);
  }

  const syncText = t(`engineeringMore.syncState.${status.textKey}`, { count: status.count, shown: status.shown });

  function renderRows(items: MoreItem[]) {
    return items.map((item, index) => (
      <SettingsRow
        key={item.key}
        first={index === 0}
        icon={item.icon}
        label={t(item.labelKey)}
        subtitle={item.subtitleKey ? t(item.subtitleKey) : null}
        onPress={() => go(item)}
        testID={`more-${item.key}`}
      />
    ));
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <MoreHeader unreadCount={unreadCount} onNotifications={() => go(bell)} onSettings={() => go(headerSettings)} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]} showsVerticalScrollIndicator={false}>
        {profileItem ? (
          <MoreIdentityCard
            name={name}
            roleLabel={t(`engineeringMore.roleLine.${role}`)}
            hotelName={hotelName}
            avatarUri={profile?.avatar_url ?? user?.avatar_url ?? null}
            connection={{ text: syncText, color: toneColor[status.tone], icon: status.icon, hint: t(status.kind === "unavailable" ? "engineeringMore.syncState.hintUnavailable" : "engineeringSync.openHint") }}
            onProfile={() => go(profileItem)}
            onSync={() => go(syncItem)}
          />
        ) : null}
        {hub.management.length > 0 ? (
          <SettingsSection title={t("engineeringMore.management")} testID="more-management">
            {renderRows(hub.management)}
          </SettingsSection>
        ) : null}
        <SettingsSection title={t("engineeringMore.groups.tools")}>{renderRows(hub.tools)}</SettingsSection>
        <SettingsSection title={t("engineeringMore.accountSupport")}>{renderRows(hub.account)}</SettingsSection>
        {signOut ? (
          <SettingsSection>
            <SettingsRow first icon={signOut.icon} label={t(signOut.labelKey)} destructive onPress={() => go(signOut)} testID="more-signOut" />
          </SettingsSection>
        ) : null}
      </ScrollView>
      <SignOutSheet visible={signOutOpen} onClose={() => setSignOutOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 16, gap: 20 },
});
