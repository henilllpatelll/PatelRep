import { StyleSheet, Text, View } from "react-native";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { SheetActionRow, SheetNotice, SheetSection } from "@/components/home/sheetParts";
import type { ShiftRecap } from "@/lib/ai/shiftRecap";
import { formatHotelTime, formatShiftDate } from "@/lib/housekeeping/hotelTime";
import type { Translate } from "@/lib/housekeeping/myRoomsText";
import { describeReviewItem, formatDuration, type ReviewItem } from "@/lib/housekeeping/shiftReview";
import type { ShiftSummary } from "@/lib/housekeeping/shiftSummary";
import type { AiRequestStatus } from "@/lib/housekeeping/useShiftBriefing";
import { useTheme } from "@/lib/theme/useTheme";

interface Props {
  visible: boolean;
  summary: ShiftSummary;
  language: string;
  timeZone: string | null;
  online: boolean;
  recap: ShiftRecap | null;
  recapStatus: AiRequestStatus;
  t: Translate;
  onRequestRecap: () => void;
  onOpenItem: (item: ReviewItem) => void;
  onOpenSync: () => void;
  onClose: () => void;
}

/**
 * The record of a finished shift: the day, the clock-in and clock-out, break
 * time, and what happened to the rooms, in the model's own terms. It never says
 * a room was "cleaned by you" because it is inspected, shows no score or pace,
 * and works without AI. The AI recap is a separate, labelled, on-request extra.
 */
export function CompletedShiftSummarySheet({
  visible,
  summary,
  language,
  timeZone,
  online,
  recap,
  recapStatus,
  t,
  onRequestRecap,
  onOpenItem,
  onOpenSync,
  onClose,
}: Props) {
  const theme = useTheme();
  const date = formatShiftDate(summary.shiftDate, language);
  const clockIn = formatHotelTime(summary.clockedInAt, timeZone, language);
  const clockOut = formatHotelTime(summary.clockedOutAt, timeZone, language);
  const { rooms } = summary;
  const unsent = summary.sync.pending + summary.sync.failed + summary.sync.conflicts;
  const loading = recapStatus === "loading";

  return (
    <BottomSheet
      visible={visible}
      title={t("home.summary.title")}
      onClose={onClose}
      grabber
      tall
      testID="shift-summary-sheet"
      footer={<Button label={t("home.summary.done")} onPress={onClose} variant="secondary" testID="shift-summary-close" />}
    >
      {date ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.date, { color: theme.textPrimary }]} testID="summary-date">
          {date}
        </Text>
      ) : null}

      <SheetSection title={t("home.summary.sectionTimes")}>
        <Line label={t("home.summary.clockIn")} value={clockIn ?? t("home.summary.unknownTime")} testID="summary-clock-in" />
        <Line label={t("home.summary.clockOut")} value={clockOut ?? t("home.summary.unknownTime")} testID="summary-clock-out" />
        {summary.breakSeconds >= 60 ? (
          <Line label={t("home.summary.breaks")} value={formatDuration(summary.breakSeconds)} testID="summary-breaks" />
        ) : null}
        {summary.workedSeconds !== null ? (
          <Line label={t("home.summary.onShift")} value={formatDuration(summary.workedSeconds)} testID="summary-worked" />
        ) : null}
      </SheetSection>

      <SheetSection title={t("home.summary.sectionRooms")}>
        {summary.boardUsable ? (
          <>
            <Line label={t("home.summary.submitted")} value={String(rooms.submitted)} testID="summary-submitted" />
            <Line label={t("home.summary.inspected")} value={String(rooms.inspected)} testID="summary-inspected" />
            {rooms.unavailable > 0 ? <Line label={t("home.summary.unavailable")} value={String(rooms.unavailable)} testID="summary-unavailable" /> : null}
            {rooms.confirmedByYou > 0 && rooms.confirmedByYou < rooms.submitted + rooms.inspected ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]} testID="summary-confirmed-by-you">
                {t("home.clockedOut.confirmedByYou", { count: rooms.confirmedByYou })}
              </Text>
            ) : null}
          </>
        ) : (
          <SheetNotice tone="warn" text={t("home.summary.roomsUnavailable")} testID="summary-rooms-unavailable" />
        )}
      </SheetSection>

      <ItemGroup title={t("home.summary.sectionLeftOpen")} items={summary.leftOpen} t={t} onOpenItem={onOpenItem} testID="summary-left-open" />
      <ItemGroup title={t("home.summary.sectionExceptions")} items={summary.exceptions} t={t} onOpenItem={onOpenItem} testID="summary-exceptions" />
      <ItemGroup title={t("home.summary.sectionHandoffs")} items={summary.handoffs} t={t} onOpenItem={onOpenItem} testID="summary-handoffs" />

      {unsent > 0 || !summary.sync.verified ? (
        <SheetActionRow
          icon="cloud-upload-outline"
          title={t(summary.sync.verified ? "home.summary.syncWaiting" : "home.summary.syncUnverified", { count: unsent })}
          hint={t("home.summary.syncHint")}
          onPress={onOpenSync}
          testID="summary-sync"
        />
      ) : null}

      <SheetSection title={t("home.summary.sectionRecap")}>
        {recap ? (
          <View style={styles.recap} testID="summary-recap">
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>
              {t("home.summary.recapAiLabel")}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.recapText, { color: theme.textPrimary }]}>
              {recap.headline}
            </Text>
            {recap.note ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.recapText, { color: theme.textSecondary }]}>
                {recap.note}
              </Text>
            ) : null}
          </View>
        ) : (
          <>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>
              {t("home.summary.recapOptional")}
            </Text>
            {recapStatus === "unavailable" ? <SheetNotice tone="warn" text={t("home.summary.recapUnavailable")} testID="summary-recap-unavailable" /> : null}
            {recapStatus === "offline" || !online ? <SheetNotice text={t("home.summary.recapOffline")} testID="summary-recap-offline" /> : null}
            <Button
              label={t("home.summary.recapRequest")}
              icon="sparkles"
              onPress={onRequestRecap}
              variant="secondary"
              loading={loading}
              disabled={loading || !online}
              testID="summary-recap-request"
            />
          </>
        )}
      </SheetSection>
    </BottomSheet>
  );
}

function Line({ label, value, testID }: { label: string; value: string; testID?: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.line, { borderBottomColor: theme.borderSubtle }]} accessible accessibilityLabel={`${label}: ${value}`} testID={testID}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.lineLabel, { color: theme.textSecondary }]}>
        {label}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.lineValue, { color: theme.textPrimary }]}>
        {value}
      </Text>
    </View>
  );
}

function ItemGroup({
  title,
  items,
  t,
  onOpenItem,
  testID,
}: {
  title: string;
  items: ReviewItem[];
  t: Translate;
  onOpenItem: (item: ReviewItem) => void;
  testID: string;
}) {
  if (items.length === 0) return null;
  return (
    <SheetSection title={title}>
      <View style={styles.group} testID={testID}>
        {items.map((item) => {
          const copy = describeReviewItem(item, t);
          return (
            <SheetActionRow
              key={item.id}
              icon={item.kind === "maintenance" ? "build-outline" : item.kind === "exception" ? "remove-circle-outline" : "bed-outline"}
              title={copy.title}
              hint={copy.detail ?? undefined}
              onPress={() => onOpenItem(item)}
              testID={`summary-item-${item.id}`}
            />
          );
        })}
      </View>
    </SheetSection>
  );
}

const styles = StyleSheet.create({
  date: { fontSize: 20, fontWeight: "800" },
  line: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 44, borderBottomWidth: StyleSheet.hairlineWidth },
  lineLabel: { flex: 1, fontSize: 15 },
  lineValue: { fontSize: 16, fontWeight: "800" },
  hint: { fontSize: 12, lineHeight: 17 },
  group: { gap: 8 },
  recap: { gap: 6 },
  recapText: { fontSize: 15, lineHeight: 21 },
});
