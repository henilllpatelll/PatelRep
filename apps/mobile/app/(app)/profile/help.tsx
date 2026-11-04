import { useState } from "react";
import { StyleSheet, Text } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { ContactSheet } from "@/components/settings/ContactSheet";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsScreen } from "@/components/settings/SettingsScreen";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { faqTopicsForRole, isEngineeringRole, SUPPORT_ROUTES, type EngineeringTopic } from "@/lib/support/faq";
import { useTheme } from "@/lib/theme/useTheme";
import { useAppStore } from "@/stores/appStore";
import { SETTINGS_MAX_FONT_SCALE as MAX_FONT_SCALE } from "@/lib/settings/a11y";

type IconName = React.ComponentProps<typeof SettingsRow>["icon"];

const TOPIC_ICON: Record<EngineeringTopic, IconName> = {
  workOrders: "construct-outline",
  pm: "calendar-outline",
  roomsAssets: "bed-outline",
  offlineSync: "sync-outline",
  account: "person-circle-outline",
};

export default function HelpScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const role = useAppStore((s) => s.user?.effective_role ?? s.user?.role ?? null);
  const engineering = isEngineeringRole(role);
  const [contactOpen, setContactOpen] = useState(false);
  const go = (route: string) => router.push(route as never);

  if (engineering) {
    // Engineer and Chief Engineer: only topics that really have questions, then the same four supported destinations.
    const topics = faqTopicsForRole(role);
    return (
      <SettingsScreen title={t("settings.help.title")} back>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.intro, { color: theme.textMuted }]} testID="help-intro">
          {t("help.engineering.intro")}
        </Text>
        <SettingsSection title={t("help.engineering.sections.quickHelp")}>
          {topics.map((group, index) => (
            <SettingsRow
              key={group.topic}
              first={index === 0}
              icon={TOPIC_ICON[group.topic]}
              label={t(`help.faq.topics.${group.topic}.title`)}
              subtitle={t(`help.faq.topics.${group.topic}.subtitle`)}
              onPress={() => go(`${SUPPORT_ROUTES.faq}?topic=${group.topic}`)}
              testID={`row-topic-${group.topic}`}
            />
          ))}
          <SettingsRow
            icon="help-circle-outline"
            label={t("help.engineering.allQuestions.title")}
            subtitle={t("help.engineering.allQuestions.subtitle")}
            onPress={() => go(SUPPORT_ROUTES.faq)}
            testID="row-faq"
          />
        </SettingsSection>

        <SettingsSection title={t("help.engineering.sections.assistance")}>
          <SettingsRow
            first
            icon="alert-circle-outline"
            label={t("help.rows.report.title")}
            subtitle={t("help.rows.report.subtitle")}
            onPress={() => go(SUPPORT_ROUTES.report)}
            testID="row-report"
          />
          <SettingsRow
            icon="people-outline"
            label={t("help.engineering.contact.title")}
            subtitle={t("help.engineering.contact.subtitle")}
            onPress={() => setContactOpen(true)}
            testID="row-contact"
          />
        </SettingsSection>

        <SettingsSection title={t("help.engineering.sections.yourSupport")}>
          <SettingsRow
            first
            icon="document-text-outline"
            label={t("help.engineering.reports.title")}
            subtitle={t("help.engineering.reports.subtitle")}
            onPress={() => go(SUPPORT_ROUTES.myReports)}
            testID="row-my-reports"
          />
        </SettingsSection>

        <SettingsSection title={t("help.engineering.sections.troubleshooting")}>
          <SettingsRow
            first
            icon="pulse-outline"
            label={t("help.engineering.diagnostics.title")}
            subtitle={t("help.engineering.diagnostics.subtitle")}
            onPress={() => go(SUPPORT_ROUTES.diagnostics)}
            testID="row-diagnostics"
          />
        </SettingsSection>

        <ContactSheet visible={contactOpen} onClose={() => setContactOpen(false)} />
      </SettingsScreen>
    );
  }

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
