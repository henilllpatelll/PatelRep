import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { DiagnosticRows, DiagnosticsSheet } from "@/components/settings/DiagnosticsSheet";
import { SettingsScreen } from "@/components/settings/SettingsScreen";
import { Button } from "@/components/ui/Button";
import { useDiagnostics } from "@/lib/support/useDiagnostics";
import { useTheme } from "@/lib/theme/useTheme";
import { SETTINGS_MAX_FONT_SCALE as MAX_FONT_SCALE } from "@/lib/settings/a11y";


export default function DiagnosticsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { entries, ready } = useDiagnostics();
  const [previewOpen, setPreviewOpen] = useState(false);

  return (
    <SettingsScreen title={t("help.diagnostics.title")} back>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textMuted }]}>
        {t("help.diagnostics.intro")}
      </Text>
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]}>
          {t("help.diagnostics.fieldsTitle")}
        </Text>
        <DiagnosticRows entries={entries} />
        {!ready ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textMuted }]} testID="diagnostics-checking-note">
            {t("help.diagnostics.checking")}
          </Text>
        ) : null}
      </View>
      <View style={styles.never}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]}>
          {t("help.diagnostics.neverTitle")}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textSecondary }]}>
          {t("help.diagnostics.never")}
        </Text>
      </View>
      <Button label={t("help.diagnostics.share")} icon="share-outline" onPress={() => setPreviewOpen(true)} testID="diagnostics-open-share" />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textMuted, textAlign: "center" }]}>
        {t("help.diagnostics.shareHint")}
      </Text>
      <DiagnosticsSheet visible={previewOpen} entries={entries} ready={ready} canShare onClose={() => setPreviewOpen(false)} />
    </SettingsScreen>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: 14, lineHeight: 20, paddingHorizontal: 4 },
  card: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 6 },
  title: { fontSize: 15, fontWeight: "700" },
  note: { fontSize: 13, lineHeight: 18 },
  never: { gap: 4, paddingHorizontal: 4 },
});
