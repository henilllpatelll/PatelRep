import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { totalPending, useUnsyncedSummary, type PendingCategory } from "@/lib/auth/pendingWork";
import { useTheme } from "@/lib/theme/useTheme";

const MAX_FONT_SCALE = 1.4;

function formatWhen(iso: string | null, language: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(language === "es" ? "es-US" : "en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** One line per kind of saved-but-unsent work, built only from what is really queued on this phone. */
export function UnsyncedList({ rows }: { rows: PendingCategory[] }) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  return (
    <View style={styles.list} testID="unsynced-list">
      {rows.map((row) => {
        const when = formatWhen(row.oldestAt, i18n?.language ?? "en");
        return (
          <View key={row.key} style={[styles.row, { backgroundColor: theme.surfaceMuted, borderColor: theme.borderSubtle }]} testID={`unsynced-${row.key}`}>
            <View style={styles.rowText}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.label, { color: theme.textPrimary }]}>
                {t(`security.unsynced.categories.${row.key}`)}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textMuted }]}>
                {row.needsAttention > 0
                  ? t("security.unsynced.needsAttention", { count: row.needsAttention })
                  : t("security.unsynced.waiting")}
                {when ? ` · ${t("security.unsynced.since", { when })}` : ""}
              </Text>
            </View>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.count, { color: theme.textPrimary }]}>
              {row.count}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export function UnsyncedChangesSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const rows = useUnsyncedSummary();
  return (
    <BottomSheet
      visible={visible}
      title={t("security.unsynced.title")}
      onClose={onClose}
      testID="unsynced-sheet"
      footer={<Button label={t("common.close")} variant="secondary" onPress={onClose} testID="unsynced-close" />}
    >
      {rows.length === 0 ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.empty, { color: theme.textSecondary }]} testID="unsynced-empty">
          {t("security.unsynced.none")}
        </Text>
      ) : (
        <>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.intro, { color: theme.textSecondary }]}>
            {t("security.unsynced.intro", { count: totalPending(rows) })}
          </Text>
          <UnsyncedList rows={rows} />
        </>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  list: { gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 12, padding: 12 },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  label: { fontSize: 14.5, fontWeight: "700" },
  meta: { fontSize: 12.5, lineHeight: 17 },
  count: { fontSize: 18, fontWeight: "800" },
  intro: { fontSize: 14, lineHeight: 20 },
  empty: { fontSize: 14, lineHeight: 20 },
});
