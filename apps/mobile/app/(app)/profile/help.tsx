import { useState } from "react";
import { StyleSheet, Text } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { ContactSheet } from "@/components/settings/ContactSheet";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsScreen } from "@/components/settings/SettingsScreen";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { SUPPORT_ROUTES } from "@/lib/support/faq";
import { useTheme } from "@/lib/theme/useTheme";
import { SETTINGS_MAX_FONT_SCALE as MAX_FONT_SCALE } from "@/lib/settings/a11y";

export default function HelpScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const [contactOpen, setContactOpen] = useState(false);
  const go = (route: string) => router.push(route as never);

  return (
    <SettingsScreen title={t("settings.help.title")} back>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.intro, { color: theme.textMuted }]}>
        {t("help.intro")}
      </Text>

      <SettingsSection title={t("help.sections.getHelp")}>
        <SettingsRow
          first
          icon="help-circle-outline"
          label={t("help.rows.faq.title")}
          subtitle={t("help.rows.faq.subtitle")}
          onPress={() => go(SUPPORT_ROUTES.faq)}
          testID="row-faq"
        />
        <SettingsRow
          icon="alert-circle-outline"
          label={t("help.rows.report.title")}
          subtitle={t("help.rows.report.subtitle")}
          onPress={() => go(SUPPORT_ROUTES.report)}
          testID="row-report"
        />
        <SettingsRow
          icon="people-outline"
          label={t("help.rows.contact.title")}
          subtitle={t("help.rows.contact.subtitle")}
          onPress={() => setContactOpen(true)}
          testID="row-contact"
        />
      </SettingsSection>

      <SettingsSection title={t("help.sections.support")}>
        <SettingsRow
          first
          icon="document-text-outline"
          label={t("help.rows.reports.title")}
          subtitle={t("help.rows.reports.subtitle")}
          onPress={() => go(SUPPORT_ROUTES.myReports)}
          testID="row-my-reports"
        />
        <SettingsRow
          icon="pulse-outline"
          label={t("help.rows.diagnostics.title")}
          subtitle={t("help.rows.diagnostics.subtitle")}
          onPress={() => go(SUPPORT_ROUTES.diagnostics)}
          testID="row-diagnostics"
        />
      </SettingsSection>

      <ContactSheet visible={contactOpen} onClose={() => setContactOpen(false)} />
    </SettingsScreen>
  );
}

const styles = StyleSheet.create({
  intro: { fontSize: 14, lineHeight: 20, paddingHorizontal: 4 },
});
