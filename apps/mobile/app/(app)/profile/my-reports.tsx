import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { SettingsScreen } from "@/components/settings/SettingsScreen";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { Button } from "@/components/ui/Button";
import { listMyReports, type MyReport } from "@/lib/api/support";
import { SUPPORT_ROUTES } from "@/lib/support/faq";
import { useTheme } from "@/lib/theme/useTheme";

const MAX_FONT_SCALE = 1.4;
type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; reports: MyReport[] };

function formatDate(iso: string, language: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(language === "es" ? "es-US" : "en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function MyReportsScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [selected, setSelected] = useState<MyReport | null>(null);

  const load = useCallback(() => {
    let live = true;
    setState({ kind: "loading" });
    listMyReports()
      .then((reports) => live && setState({ kind: "ready", reports }))
      .catch(() => live && setState({ kind: "error" }));
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => load(), [load]);

  const areaLabel = (report: MyReport) => t(`help.report.areas.${report.area ?? "other"}`);
  const statusLabel = (report: MyReport) => {
    const key = `help.reports.status.${report.status}`;
    const text = t(key);
    return text === key ? report.status : text;
  };

  return (
    <SettingsScreen title={t("help.reports.title")} back>
      {state.kind === "loading" ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textMuted }]}>
          {t("common.loading")}
        </Text>
      ) : state.kind === "error" ? (
        <View style={styles.stack}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="alert" style={[styles.body, { color: theme.status.dirty }]} testID="reports-error">
            {t("help.reports.loadError")}
          </Text>
          <Button label={t("help.reports.retry")} variant="secondary" size="sm" onPress={() => void load()} testID="reports-retry" />
        </View>
      ) : state.reports.length === 0 ? (
        <View style={styles.stack} testID="reports-empty">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
            {t("help.reports.empty")}
          </Text>
          <Button label={t("help.reports.emptyAction")} onPress={() => router.push(SUPPORT_ROUTES.report as never)} testID="reports-empty-action" />
        </View>
      ) : (
        <SettingsSection testID="reports-list">
          {state.reports.map((report, index) => (
            <Pressable
              key={report.id}
              onPress={() => setSelected(report)}
              accessibilityRole="button"
              accessibilityLabel={[areaLabel(report), report.message, t("help.reports.submitted", { date: formatDate(report.created_at, i18n.language) }), t("help.reports.statusLabel", { status: statusLabel(report) })].join(". ")}
              style={({ pressed }) => [
                styles.row,
                index > 0 && { borderTopColor: theme.borderSubtle, borderTopWidth: StyleSheet.hairlineWidth },
                pressed && { backgroundColor: theme.surfaceMuted },
              ]}
              testID="report-row"
            >
              <View style={styles.rowText}>
                <View style={styles.rowTop}>
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowTitle, { color: theme.textPrimary }]}>
                    {areaLabel(report)}
                  </Text>
                  {/* The status is always words, never colour alone. */}
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.status, { color: report.status === "closed" ? theme.status.ready : theme.status.pickup }]} testID="report-status">
                    {statusLabel(report)}
                  </Text>
                </View>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={2} style={[styles.preview, { color: theme.textSecondary }]}>
                  {report.message}
                </Text>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.date, { color: theme.textMuted }]}>
                  {t("help.reports.submitted", { date: formatDate(report.created_at, i18n.language) })}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={theme.textDisabled} />
            </Pressable>
          ))}
        </SettingsSection>
      )}

      <BottomSheet
        visible={selected !== null}
        title={selected ? areaLabel(selected) : t("help.reports.detail")}
        onClose={() => setSelected(null)}
        grabber
        testID="report-detail-sheet"
        footer={<Button label={t("common.close")} variant="secondary" onPress={() => setSelected(null)} testID="report-detail-close" />}
      >
        {selected ? (
          <View style={styles.stack}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.status, { color: theme.textPrimary }]}>
              {t("help.reports.statusLabel", { status: statusLabel(selected) })}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.date, { color: theme.textMuted }]}>
              {t("help.reports.submitted", { date: formatDate(selected.created_at, i18n.language) })}
              {selected.severity === "blocking" ? ` · ${t("help.reports.blockingYes")}` : ""}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textPrimary }]} selectable testID="report-detail-message">
              {selected.message}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.date, { color: theme.textMuted }]}>
              {t("help.reports.noReply")}
            </Text>
          </View>
        ) : null}
      </BottomSheet>
    </SettingsScreen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 10 },
  body: { fontSize: 14.5, lineHeight: 21 },
  row: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  rowText: { flex: 1, minWidth: 0, gap: 3 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  rowTitle: { flex: 1, fontSize: 15, fontWeight: "700" },
  status: { fontSize: 12.5, fontWeight: "800" },
  preview: { fontSize: 13.5, lineHeight: 19 },
  date: { fontSize: 12.5, lineHeight: 17 },
});
