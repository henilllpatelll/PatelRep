import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { SheetActionRow, SheetGone, SheetNotice, SheetSection } from "@/components/home/sheetParts";
import { formatHotelTime } from "@/lib/housekeeping/hotelTime";
import type { TextContext, Translate } from "@/lib/housekeeping/myRoomsText";
import {
  describeReviewItem,
  formatDuration,
  type ReviewItem,
  type ReviewItemKind,
  type ShiftReview,
  type ReviewWarning,
} from "@/lib/housekeeping/shiftReview";
import { useTheme } from "@/lib/theme/useTheme";

export type ClockOutError = "offline" | "failed" | "not_allowed" | null;

interface Props {
  visible: boolean;
  review: ShiftReview;
  /** The clock-out request is in flight. */
  clockingOut: boolean;
  error: ClockOutError;
  /** The server says there is no open shift (clocked out elsewhere). Not shown for the clock-out this sheet just made. */
  alreadyEnded: boolean;
  language: string;
  timeZone: string | null;
  t: Translate;
  ctx: TextContext;
  onClockOut: () => void;
  onOpenItem: (item: ReviewItem) => void;
  onOpenSync: () => void;
  onClose: () => void;
}

const ICON: Record<ReviewItemKind, keyof typeof Ionicons.glyphMap> = {
  sync: "cloud-offline-outline",
  unfinished: "bed-outline",
  attention: "alert-circle-outline",
  exception: "remove-circle-outline",
  maintenance: "build-outline",
  tasks: "checkbox-outline",
  lost_found: "briefcase-outline",
};

const WARNING_KEY: Record<ReviewWarning, string> = {
  board_unverified: "home.review.warnings.boardUnverified",
  active_room: "home.review.warnings.activeRoom",
  rooms_remaining: "home.review.warnings.roomsRemaining",
  pending_sync: "home.review.warnings.pendingSync",
  sync_unverified: "home.review.warnings.syncUnverified",
  sync_problem: "home.review.warnings.syncProblem",
};

/**
 * The last look before clocking out. It shows the day exactly as the shared
 * model records it and lists only real handoffs and exceptions. It never blocks
 * clock-out on its own opinion: unfinished rooms and unsent work are named so
 * the choice is informed, and the only things that stop the button are the ones
 * the server itself requires (an open shift and a connection).
 */
export function FinishShiftReviewSheet({
  visible,
  review,
  clockingOut,
  error,
  alreadyEnded,
  language,
  timeZone,
  t,
  onClockOut,
  onOpenItem,
  onOpenSync,
  onClose,
}: Props) {
  const theme = useTheme();
  const { totals, sync, items, warnings } = review;
  const started = formatHotelTime(review.startedAt, timeZone, language);
  const meta = [
    started ? t("home.review.startedAt", { time: started }) : null,
    review.breakSeconds >= 60 ? t("home.review.breakTime", { duration: formatDuration(review.breakSeconds) }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const unsent = sync.pending + sync.failed + sync.conflicts;
  const blocked = review.blockedBy;
  const hasOpenWork = warnings.includes("active_room") || warnings.includes("rooms_remaining");
  const clockOutDisabled = !review.canClockOut || clockingOut;

  if (alreadyEnded) {
    return (
      <BottomSheet visible={visible} title={t("home.review.title")} onClose={onClose} grabber tall testID="finish-shift-sheet">
        <SheetGone
          title={t("home.review.endedTitle")}
          body={t("home.review.endedBody")}
          closeLabel={t("home.review.returnHome")}
          onClose={onClose}
          testID="finish-shift-ended"
        />
      </BottomSheet>
    );
  }

  return (
    <BottomSheet
      visible={visible}
      title={t("home.review.title")}
      onClose={onClose}
      grabber
      tall
      testID="finish-shift-sheet"
      footer={
        <>
          <Button
            label={t(hasOpenWork ? "home.review.clockOutAnyway" : "home.review.clockOut")}
            onPress={onClockOut}
            size="lg"
            loading={clockingOut}
            disabled={clockOutDisabled}
            testID="finish-shift-clock-out"
          />
          {blocked === "offline" ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]} testID="finish-shift-offline">
              {t("home.review.needsConnection")}
            </Text>
          ) : null}
          <Button label={t("home.review.returnHome")} onPress={onClose} variant="secondary" disabled={clockingOut} testID="finish-shift-return" />
        </>
      }
    >
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.lead, { color: theme.textSecondary }]}>
        {t("home.review.lead")}
      </Text>
      {meta ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textMuted }]} testID="finish-shift-meta">
          {meta}
        </Text>
      ) : null}

      {error ? (
        <SheetNotice tone="error" text={t(`home.review.errors.${error}`)} testID="finish-shift-error" />
      ) : null}

      <SheetSection title={t("home.review.sectionToday")}>
        {review.boardUsable ? (
          <>
            <TotalRow label={t("home.review.totals.completed", { count: totals.completed })} value={totals.completed} testID="review-completed" />
            {totals.completed > 0 && (totals.submitted > 0 || totals.inspected > 0) ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]} testID="review-breakdown">
                {t("home.progress.detail", { submitted: totals.submitted, inspected: totals.inspected })}
              </Text>
            ) : null}
            {totals.unavailable > 0 ? (
              <TotalRow label={t("home.review.totals.unavailable", { count: totals.unavailable })} value={totals.unavailable} testID="review-unavailable" />
            ) : null}
            {totals.exceptions > 0 ? (
              <TotalRow label={t("home.review.totals.exceptions", { count: totals.exceptions })} value={totals.exceptions} testID="review-exceptions" />
            ) : null}
            {totals.inProgress > 0 ? (
              <TotalRow label={t("home.review.totals.inProgress", { count: totals.inProgress })} value={totals.inProgress} warn testID="review-in-progress" />
            ) : null}
            {totals.notStarted > 0 ? (
              <TotalRow label={t("home.review.totals.notStarted", { count: totals.notStarted })} value={totals.notStarted} warn testID="review-not-started" />
            ) : null}
          </>
        ) : null}
        <SyncRow
          unsent={unsent}
          verified={sync.verified}
          t={t}
          onPress={onOpenSync}
        />
      </SheetSection>

      {warnings.length > 0 ? (
        <View style={styles.notices}>
          {warnings.map((warning) => (
            <SheetNotice
              key={warning}
              tone={warning === "sync_problem" ? "error" : "warn"}
              // "not started" counts only rooms nobody has opened; the open room has its own warning.
              text={t(WARNING_KEY[warning], { room: review.activeRoomNumber ?? "", count: totals.notStarted })}
              testID={`review-warning-${warning}`}
            />
          ))}
        </View>
      ) : null}

      {items.length > 0 ? (
        <SheetSection title={t("home.review.sectionHandoffs")} hint={t("home.review.handoffsHint")}>
          {items.map((item) => {
            const copy = describeReviewItem(item, t);
            return (
              <SheetActionRow
                key={item.id}
                icon={ICON[item.kind]}
                title={copy.title}
                hint={copy.detail ?? undefined}
                onPress={() => onOpenItem(item)}
                testID={`review-item-${item.id}`}
              />
            );
          })}
        </SheetSection>
      ) : null}
    </BottomSheet>
  );
}

function TotalRow({ label, value, warn, testID }: { label: string; value: number; warn?: boolean; testID?: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.totalRow, { borderBottomColor: theme.borderSubtle }]} accessible accessibilityLabel={label} testID={testID}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.totalValue, { color: warn ? theme.status.pickup : theme.textPrimary }]}>
        {value}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.totalLabel, { color: theme.textPrimary }]}>
        {label}
      </Text>
    </View>
  );
}

function SyncRow({ unsent, verified, t, onPress }: { unsent: number; verified: boolean; t: Translate; onPress: () => void }) {
  const theme = useTheme();
  const label = !verified ? t("home.review.sync.unverified") : unsent > 0 ? t("home.review.sync.waiting", { count: unsent }) : t("home.review.sync.none");
  const clear = verified && unsent === 0;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${t("home.review.sync.open")}`}
      style={({ pressed }) => [styles.syncRow, { borderColor: theme.borderSubtle }, pressed && { opacity: 0.7 }]}
      testID="review-sync"
    >
      <Ionicons name={clear ? "checkmark-circle-outline" : "cloud-upload-outline"} size={20} color={clear ? theme.status.ready : theme.status.pickup} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.syncLabel, { color: theme.textPrimary }]}>
        {label}
      </Text>
      <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  lead: { fontSize: 15, lineHeight: 21 },
  meta: { fontSize: 13, lineHeight: 18 },
  hint: { fontSize: 12, lineHeight: 17 },
  notices: { gap: 8 },
  totalRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44, borderBottomWidth: StyleSheet.hairlineWidth },
  totalValue: { fontSize: 24, fontWeight: "800", minWidth: 36 },
  totalLabel: { flex: 1, fontSize: 15, fontWeight: "600" },
  syncRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: MIN_TARGET, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 4 },
  syncLabel: { flex: 1, fontSize: 14, fontWeight: "600" },
});
