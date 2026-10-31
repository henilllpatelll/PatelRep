import { useState } from "react";
import { StyleSheet, Text } from "react-native";
import { Redirect, router } from "expo-router";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/stores/appStore";
import { SignOutSheet } from "@/components/security/SignOutSheet";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsScreen } from "@/components/settings/SettingsScreen";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { getEngineeringMoreSections, type MoreItem } from "@/lib/engineering/moreMenu";
import { isEngineeringRole } from "@/lib/engineering/roles";
import { SETTINGS_MAX_FONT_SCALE as MAX_FONT_SCALE } from "@/lib/settings/a11y";
import { useTheme } from "@/lib/theme/useTheme";

/** Engineering More tab: rooms, notifications and the account tools that used to sit behind Rooms and Profile. */
export default function EngineeringMoreScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const role = useAppStore((s) => s.user?.effective_role ?? s.user?.role);
  const unreadCount = useAppStore((s) => s.unreadCount);
  const [signOutOpen, setSignOutOpen] = useState(false);

  // The route exists for every role (tabs are declared once); only engineering roles have a More tab.
  if (!isEngineeringRole(role)) return <Redirect href="/(app)/home" />;

  const sections = getEngineeringMoreSections(role);

  function press(item: MoreItem) {
    if (item.action === "signOut") setSignOutOpen(true);
    else if (item.href) router.push(item.href as never);
  }

  return (
    <SettingsScreen title={t("tabs.more")}>
      {sections.map((section) => (
        <SettingsSection key={section.key} title={t(section.titleKey)}>
          {section.items.map((item, index) => (
            <SettingsRow
              key={item.key}
              first={index === 0}
              icon={item.icon}
              label={t(item.labelKey)}
              destructive={item.destructive}
              trailing={item.badge === "unread" && unreadCount > 0 ? (unreadCount > 99 ? "99+" : String(unreadCount)) : null}
              onPress={() => press(item)}
              testID={`more-${item.key}`}
            />
          ))}
        </SettingsSection>
      ))}
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textDisabled }]}>
        {t("engineeringMore.hint")}
      </Text>
      <SignOutSheet visible={signOutOpen} onClose={() => setSignOutOpen(false)} />
    </SettingsScreen>
  );
}

const styles = StyleSheet.create({
  note: { textAlign: "center", fontSize: 12 },
});
