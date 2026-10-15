import { StyleSheet, Text, View } from "react-native";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { SheetNotice, SheetSection } from "@/components/home/sheetParts";
import type { ProgressDetails } from "@/lib/housekeeping/homeSheets";
import { formatHotelTime } from "@/lib/housekeeping/hotelTime";
import type { Translate } from "@/lib/housekeeping/myRoomsText";
import type { ShiftLifecycle } from "@/lib/housekeeping/shiftLifecycle";
import { useTheme } from "@/lib/theme/useTheme";

interface Props {
  visible: boolean;
  details: ProgressDetails;
  lifecycle: ShiftLifecycle;
  language: string;
  timeZone: string | null;
  t: Translate;
  onOpenMyRooms: () => void;
  onClose: () => void;
}

/**
 * Where the shift stands, read off the shared progress model. The five room
 * rows are mutually exclusive and add up to the assigned total (shown only when
 * they really do); flags that can overlap sit apart and say so. Nothing is
 * ranked, projected or compared with anyone.
 */
export function ShiftProgressSheet({ visible, details, lifecycle, language, timeZone, t, onOpenMyRooms, onClose }: Props) {
  const theme = useTheme();

  const startedAt = formatHotelTime(lifecycle.startedAt, timeZone, language);
  const since = formatHotelTime(lifecycle.onBreakSince, timeZone, language);
  const shiftLine =
    lifecycle.state === "not_started"
      ? t("home.progressSheet.notStarted")
      : lifecycle.state === "unknown"
        ? t("home.progressSheet.shiftUnknown")
        : startedAt
          ? t("home.progressSheet.started", { time: startedAt })
          : null;

  const rooms: Array<{ key: string; label: string; value: number; sub?: string }> = [
    { key: "completed", label: t("home.progressSheet.completed"), value: details.completed, sub: t("home.progress.detail", { submitted: details.submitted, inspected: details.inspected }) },
    { key: "toClean", label: t("home.progress.toClean"), value: details.toClean },
    { key: "inProgress", label: t("home.progress.inProgress"), value: details.inProgress },
    { key: "needsAttention", label: t("home.progress.needAttention"), value: details.needsAttention },
    { key: "unavailable", label: t("home.progressSheet.unavailable"), value: details.unavailable },
  ];
  const flags: Array<{ key: string; label: string; value: number }> = [
    { key: "rush", label: t("home.progressSheet.flagRush"), value: details.flags.rush },
    { key: "reclean", label: t("home.progressSheet.flagReclean"), value: details.flags.reclean },
    { key: "arrivals", label: t("home.progressSheet.flagArrivals"), value: details.flags.arrivalsSoon },
  ].filter((flag) => flag.value > 0);

  return (
    <BottomSheet
      visible={visible}
      title={t("home.progressSheet.title")}
      onClose={onClose}
      grabber
      testID="progress-sheet"
      footer={<Button label={t("home.progressSheet.openMyRooms")} onPress={onOpenMyRooms} variant="secondary" testID="progress-open-my-rooms" />}
    >
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.headline, { color: theme.textPrimary }]} testID="progress-sheet-headline">
        {details.serviceable > 0 ? t("home.progress.headline", { done: details.completed, total: details.serviceable }) : t("home.progress.noneServiceable")}
      </Text>
      {shiftLine ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textSecondary }]} testID="progress-sheet-started">
          {shiftLine}
        </Text>
      ) : null}
      {lifecycle.state === "on_break" ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textSecondary }]} testID="progress-sheet-break">
          {since ? t("home.progressSheet.onBreakSince", { time: since }) : t("home.progressSheet.onBreak")}
        </Text>
      ) : null}

      <SheetSection
        title={t("home.progressSheet.sectionRooms")}
        hint={details.reconciles ? t("home.progressSheet.reconcile", { count: details.assigned }) : undefined}
      >
        {rooms.map((row) => (
          <View key={row.key} style={[styles.row, { borderBottomColor: theme.borderSubtle }]} testID={`progress-row-${row.key}`}>
            <View style={styles.rowText}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowLabel, { color: theme.textPrimary }]}>
                {row.label}
              </Text>
              {row.sub && row.value > 0 ? (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowSub, { color: theme.textMuted }]}>
                  {row.sub}
                </Text>
              ) : null}
            </View>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowValue, { color: theme.textPrimary }]} testID={`progress-value-${row.key}`}>
              {row.value}
            </Text>
          </View>
        ))}
        <View style={[styles.row, styles.totalRow, { borderTopColor: theme.border }]} testID="progress-row-assigned">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowLabel, { color: theme.textSecondary }]}>
            {t("home.progressSheet.assigned")}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowValue, { color: theme.textSecondary }]} testID="progress-value-assigned">
            {details.assigned}
          </Text>
        </View>
      </SheetSection>

      {details.awaitingConfirmation > 0 ? (
        <SheetNotice text={t("home.progressSheet.waiting", { count: details.awaitingConfirmation })} testID="progress-waiting" />
      ) : null}
      {details.unavailable > 0 ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>
          {t("home.progressSheet.unavailableNote")}
        </Text>
      ) : null}

      {flags.length > 0 ? (
        <SheetSection title={t("home.progressSheet.sectionFlags")} hint={t("home.progressSheet.flagsHint")}>
          {flags.map((flag) => (
            <View key={flag.key} style={[styles.row, { borderBottomColor: theme.borderSubtle }]} testID={`progress-flag-${flag.key}`}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowLabel, { color: theme.textPrimary }]}>
                {flag.label}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowValue, { color: theme.textPrimary }]}>
                {flag.value}
              </Text>
            </View>
          ))}
        </SheetSection>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  headline: { fontSize: 24, fontWeight: "800", lineHeight: 30 },
  meta: { fontSize: 14, lineHeight: 20 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 44, borderBottomWidth: StyleSheet.hairlineWidth },
  totalRow: { borderBottomWidth: 0, borderTopWidth: StyleSheet.hairlineWidth },
  rowText: { flex: 1, minWidth: 0 },
  rowLabel: { fontSize: 15, fontWeight: "600" },
  rowSub: { fontSize: 12, lineHeight: 17 },
  rowValue: { fontSize: 18, fontWeight: "800" },
  hint: { fontSize: 12, lineHeight: 17 },
});
