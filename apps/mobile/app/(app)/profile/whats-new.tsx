import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/ui/EmptyState";
import { monoFont } from "@/components/shared/tokens";
import { SettingsScreen } from "@/components/settings/SettingsScreen";
import { getAppInfo } from "@/lib/app/appInfo";
import { RELEASE_NOTE_SECTIONS, findReleaseNotes, formatReleaseDate, localized } from "@/lib/app/releaseNotes";
import { useTheme } from "@/lib/theme/useTheme";

const MAX_FONT_SCALE = 1.4;

/** Release notes for the installed version, bundled with the app (so they also work offline). */
export default function WhatsNewScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const info = useMemo(() => getAppInfo(), []);
  const notes = findReleaseNotes(info.version);
  const date = notes ? formatReleaseDate(notes.date, i18n.language) : null;

  return (
    <SettingsScreen title={t("about.whatsNew.title")} back>
      {!notes ? (
        <View testID="whats-new-empty">
          <EmptyState icon="sparkles-outline" title={t("about.whatsNew.emptyTitle")} />
        </View>
      ) : (
        <View style={styles.wrap} testID="whats-new-notes">
          <View style={styles.heading}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.headline, { color: theme.textPrimary }]}>
              {t("about.whatsNew.headline")}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textMuted }]} testID="whats-new-version">
              {[t("about.whatsNew.version", { version: notes.version }), date].filter(Boolean).join(" · ")}
            </Text>
          </View>
          {RELEASE_NOTE_SECTIONS.map((section) => {
            const items = notes[section] ?? [];
            if (items.length === 0) return null;
            return (
              <View key={section} style={styles.section} testID={`whats-new-${section}`}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.sectionTitle, { color: theme.textMuted }]}>
                  {t(`about.whatsNew.sections.${section}`)}
                </Text>
                {items.map((item, index) => (
                  <View key={index} style={styles.item}>
                    <Text style={[styles.bullet, { color: theme.textMuted }]} importantForAccessibility="no" accessibilityElementsHidden>
                      {"•"}
                    </Text>
                    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.itemText, { color: theme.textPrimary }]}>
                      {localized(item, i18n.language)}
                    </Text>
                  </View>
                ))}
              </View>
            );
          })}
        </View>
      )}
    </SettingsScreen>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 20 },
  heading: { gap: 4, paddingHorizontal: 4 },
  headline: { fontSize: 18, fontWeight: "700" },
  meta: { fontFamily: monoFont, fontSize: 12.5 },
  section: { gap: 8, paddingHorizontal: 4 },
  sectionTitle: { fontSize: 12, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" },
  item: { flexDirection: "row", gap: 10 },
  bullet: { fontSize: 15, lineHeight: 22 },
  itemText: { flex: 1, fontSize: 15, lineHeight: 22 },
});
