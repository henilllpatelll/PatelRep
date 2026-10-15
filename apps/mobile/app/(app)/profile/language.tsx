import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { SettingsChoiceRow } from "@/components/settings/SettingsChoiceRow";
import { SettingsScreen } from "@/components/settings/SettingsScreen";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { normalizeLanguage, type AppLanguage } from "@/lib/language/languagePreference";
import { retryPendingLanguageSync, selectLanguage, useLanguageSyncStore } from "@/lib/language/languageSync";
import { useTheme } from "@/lib/theme/useTheme";
import { useAppStore } from "@/stores/appStore";

// Each language is named in itself, so it stays readable whatever the app is set to.
const OPTIONS: { code: AppLanguage; label: string; hintKey: string }[] = [
  { code: "en", label: "English", hintKey: "profile.languageScreen.englishHint" },
  { code: "es", label: "Español", hintKey: "profile.languageScreen.spanishHint" },
];

export default function LanguageSettingsScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const userId = useAppStore((s) => s.user?.id ?? null);
  const syncState = useLanguageSyncStore((s) => s.syncState);
  const current = normalizeLanguage(i18n.language) ?? "en";

  function choose(next: AppLanguage) {
    if (next === current || !userId) return;
    void selectLanguage(userId, next);
  }

  return (
    <SettingsScreen title={t("profile.language")} back>
      <Text maxFontSizeMultiplier={1.4} style={[styles.intro, { color: theme.textMuted }]}>
        {t("profile.languageScreen.intro")}
      </Text>
      <SettingsSection testID="language-options">
        <View accessibilityRole="radiogroup" accessibilityLabel={t("profile.language")} testID="language-group">
          {OPTIONS.map((option, index) => (
            <SettingsChoiceRow
              key={option.code}
              first={index === 0}
              label={option.label}
              hint={t(option.hintKey)}
              selected={current === option.code}
              onPress={() => choose(option.code)}
              testID={`language-${option.code}`}
            />
          ))}
        </View>
      </SettingsSection>
      {syncState !== "idle" ? (
        <View style={styles.notice} accessibilityLiveRegion="polite" testID="language-sync-notice">
          <Text
            maxFontSizeMultiplier={1.4}
            style={[styles.noticeText, { color: syncState === "failed" ? theme.status.dirty : theme.textMuted }]}
          >
            {syncState === "failed" ? t("profile.languageScreen.failed") : t("profile.languageScreen.pending")}
          </Text>
          {syncState === "failed" ? (
            <Pressable
              onPress={() => void retryPendingLanguageSync()}
              accessibilityRole="button"
              accessibilityLabel={t("profile.languageScreen.retry")}
              hitSlop={8}
              style={styles.retry}
              testID="language-retry"
            >
              <Text maxFontSizeMultiplier={1.4} style={[styles.retryText, { color: theme.primary }]}>
                {t("profile.languageScreen.retry")}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </SettingsScreen>
  );
}

const styles = StyleSheet.create({
  intro: { fontSize: 14, lineHeight: 20, paddingHorizontal: 4 },
  notice: { gap: 4, paddingHorizontal: 4 },
  noticeText: { fontSize: 13, lineHeight: 18 },
  retry: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  retryText: { fontSize: 14, fontWeight: "700" },
});
