import { Share, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { useTextContext } from "@/components/housekeeping/useTextContext";
import { formatClock } from "@/lib/housekeeping/myRoomsText";
import { diagnosticsToText, type DiagnosticEntry, type DiagnosticKey } from "@/lib/support/diagnostics";
import { useTheme } from "@/lib/theme/useTheme";

const MAX_FONT_SCALE = 1.4;

/** One human-readable value per diagnostic field. */
export function useDiagnosticDisplay() {
  const { t } = useTranslation();
  const ctx = useTextContext();
  const label = (key: DiagnosticKey) => t(`help.diagnostics.fields.${key}`);
  const display = (entry: DiagnosticEntry): string => {
    switch (entry.key) {
      case "online":
        return entry.value ? t("help.diagnostics.yes") : t("help.diagnostics.no");
      case "last_synced_at":
        return formatClock(String(entry.value), ctx) ?? String(entry.value);
      case "sync_status": {
        const key = `help.diagnostics.syncStatuses.${entry.value}`;
        const text = t(key);
        return text === key ? String(entry.value) : text;
      }
      default:
        return String(entry.value);
    }
  };
  return { label, display };
}

export function DiagnosticRows({ entries }: { entries: DiagnosticEntry[] }) {
  const theme = useTheme();
  const { label, display } = useDiagnosticDisplay();
  return (
    <View style={styles.rows} testID="diagnostic-rows">
      {entries.map((entry) => (
        <View key={entry.key} style={[styles.row, { borderBottomColor: theme.borderSubtle }]} accessible accessibilityLabel={`${label(entry.key)}: ${display(entry)}`} testID={`diagnostic-${entry.key}`}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowLabel, { color: theme.textMuted }]}>
            {label(entry.key)}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowValue, { color: theme.textPrimary }]}>
            {display(entry)}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** Exact preview of what a report (or the share menu) would carry. Sharing is the person's choice, every time. */
export function DiagnosticsSheet({
  visible,
  entries,
  ready,
  canShare,
  onClose,
}: {
  visible: boolean;
  entries: DiagnosticEntry[];
  ready: boolean;
  canShare: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { label, display } = useDiagnosticDisplay();

  async function share() {
    try {
      await Share.share({ message: diagnosticsToText(entries, label, display) });
    } catch {
      // The share menu was dismissed or unavailable: nothing was shared, and nothing says it was.
    }
  }

  return (
    <BottomSheet
      visible={visible}
      title={t("help.diagnostics.previewTitle")}
      onClose={onClose}
      grabber
      testID="diagnostics-sheet"
      footer={
        <>
          {canShare ? <Button label={t("help.diagnostics.share")} icon="share-outline" onPress={() => void share()} testID="diagnostics-share" /> : null}
          <Button label={canShare ? t("help.diagnostics.cancel") : t("common.close")} variant="secondary" onPress={onClose} testID="diagnostics-cancel" />
        </>
      }
    >
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.intro, { color: theme.textSecondary }]}>
        {t("help.diagnostics.previewIntro")}
      </Text>
      <DiagnosticRows entries={entries} />
      {!ready ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.intro, { color: theme.textMuted }]} testID="diagnostics-checking">
          {t("help.diagnostics.checking")}
        </Text>
      ) : null}
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.intro, { color: theme.textMuted }]}>
        {t("help.diagnostics.neverTitle")}: {t("help.diagnostics.never")}
      </Text>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  intro: { fontSize: 13.5, lineHeight: 19 },
  rows: { gap: 0 },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth },
  rowLabel: { flex: 1, fontSize: 13.5 },
  rowValue: { flexShrink: 1, fontSize: 13.5, fontWeight: "600", textAlign: "right" },
});
