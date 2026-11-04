import { useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { DiagnosticRows, DiagnosticsSheet } from "@/components/settings/DiagnosticsSheet";
import { SettingsScreen } from "@/components/settings/SettingsScreen";
import { Button } from "@/components/ui/Button";
import { ENGINEERING_SYNC_ROUTE, isEngineeringRole, SUPPORT_ROUTES } from "@/lib/support/faq";
import { useAppStore } from "@/stores/appStore";
import { useDiagnostics } from "@/lib/support/useDiagnostics";
import { useTheme } from "@/lib/theme/useTheme";
import { SETTINGS_MAX_FONT_SCALE as MAX_FONT_SCALE } from "@/lib/settings/a11y";


export default function DiagnosticsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { entries, ready } = useDiagnostics();
  const [previewOpen, setPreviewOpen] = useState(false);
  const role = useAppStore((s) => s.user?.effective_role ?? s.user?.role ?? null);
  const engineering = isEngineeringRole(role);
  const [check, setCheck] = useState<"idle" | "checking" | "connected" | "disconnected" | "failed">("idle");
  const checking = useRef(false);

  // Read-only: asks the phone about its connection and reports it here. It changes no app state and sends nothing.
  async function checkConnection() {
    if (checking.current) return;
    checking.current = true;
    setCheck("checking");
    try {
      const state = await NetInfo.fetch();
      setCheck(state.isConnected ? "connected" : "disconnected");
    } catch {
      setCheck("failed");
    } finally {
      checking.current = false;
    }
  }

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
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]} testID="diagnostics-recovery">
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]}>
          {t("help.diagnostics.recovery.title")}
        </Text>
        <Button
          label={engineering ? t("help.diagnostics.recovery.openSyncCenter") : t("help.diagnostics.recovery.openSync")}
          icon="sync-outline"
          variant="secondary"
          size="md"
          onPress={() => router.push((engineering ? ENGINEERING_SYNC_ROUTE : SUPPORT_ROUTES.sync) as never)}
          testID="diagnostics-open-sync"
        />
        <Button
          label={check === "checking" ? t("help.diagnostics.recovery.checking") : t("help.diagnostics.recovery.checkConnection")}
          icon="wifi-outline"
          variant="secondary"
          size="md"
          loading={check === "checking"}
          disabled={check === "checking"}
          onPress={() => void checkConnection()}
          testID="diagnostics-check-connection"
        />
        {check === "connected" || check === "disconnected" || check === "failed" ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="alert" style={[styles.note, { color: check === "connected" ? theme.textSecondary : theme.status.dirty }]} testID="diagnostics-check-result">
            {t(`help.diagnostics.recovery.${check === "failed" ? "checkFailed" : check}`)}
          </Text>
        ) : null}
        <Button label={t("help.diagnostics.recovery.report")} icon="alert-circle-outline" variant="secondary" size="md" onPress={() => router.push(SUPPORT_ROUTES.report as never)} testID="diagnostics-report" />
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
