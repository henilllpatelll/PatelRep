import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import type { Room } from "@/stores/appStore";
import { buildEntryChecks, type RoomDetailView } from "@/lib/housekeeping/roomDetailState";
import { buildReadinessFacts, buildRoomGuidance } from "@/lib/housekeeping/roomAssist";
import { useEstimateVersion } from "@/lib/housekeeping/estimateTable";
import { formatClock, type TextContext } from "@/lib/housekeeping/myRoomsText";
import { RushPriorityPanel } from "@/components/housekeeping/RushPriorityPanel";
import { RecleanCorrectionsPanel } from "@/components/housekeeping/RecleanCorrectionsPanel";
import { RoomGuidanceLine } from "./RoomGuidanceLine";
import { RoomHelpCard } from "./RoomHelpCard";
import { RoomStatusNotice } from "./RoomStatusNotice";
import { MAX_FONT_SCALE } from "./BottomSheet";

const ESTIMATE_KEY = {
  history: "rooms.readiness.estimateHistory",
  room_type: "rooms.readiness.estimateRoomType",
  general: "rooms.readiness.estimateGeneral",
} as const;

interface Props {
  room: Room;
  view: RoomDetailView;
  ctx: TextContext;
  /** Set when a non-blocking restriction note applies (e.g. the agreed retry time has arrived). */
  restriction?: ReactNode;
  onOpenInfo: () => void;
  /** The supervisor's sequence (or the standard queue) puts this room next. */
  isNext?: boolean;
}

/**
 * Ready / reclean before the first tap: what the housekeeper needs to decide
 * whether to go in — deadline, the pre-entry facts, one warning — and nothing
 * else. Reservation detail lives behind Room Information.
 */
export function BeforeCleaningView({ room, view, ctx, restriction, onOpenInfo, isNext = false }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const checks = buildEntryChecks(room);
  const reclean = view.kind === "reclean";
  useEstimateVersion(); // re-render when the learned table refreshes
  const facts = buildReadinessFacts(room);
  const guidance = buildRoomGuidance({ room, session: undefined, classification: view.classification, isNext });

  return (
    <View style={styles.root} testID="before-cleaning-view">
      {restriction}
      <RushPriorityPanel room={room} classification={view.classification} ctx={ctx} />
      {reclean ? <RecleanCorrectionsPanel room={room} checklist={undefined} ctx={ctx} /> : null}
      <RoomStatusNotice room={room} advisories={view.advisories} />

      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.eyebrow, { color: theme.textMuted }]}>
          {t("rooms.work.beforeYouEnter")}
        </Text>
        {checks.map((check) => {
          const time = check.time ? formatClock(check.time, ctx) : null;
          const text = t(check.textKey, { time: time ?? "" });
          const icon = check.tone === "ok" ? "checkmark-circle" : check.tone === "warn" ? "warning" : "information-circle-outline";
          const color = check.tone === "ok" ? theme.status.ready : check.tone === "warn" ? theme.status.dirty : theme.textMuted;
          return (
            <View key={check.key} style={styles.checkRow} accessible accessibilityLabel={text} testID={`entry-check-${check.key}`}>
              <Ionicons name={icon} size={18} color={color} />
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.checkText, { color: theme.textPrimary }]}>
                {text}
              </Text>
            </View>
          );
        })}
        {/* What the list records, said as what it is: an estimate, and maintenance "on record". */}
        <View
          style={styles.checkRow}
          accessible
          accessibilityLabel={t(ESTIMATE_KEY[facts.estimate.basis], { minutes: facts.estimate.minutes })}
          testID="readiness-estimate"
        >
          <Ionicons name="time-outline" size={18} color={theme.textMuted} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.checkText, { color: theme.textPrimary }]}>
            {t(ESTIMATE_KEY[facts.estimate.basis], { minutes: facts.estimate.minutes })}
          </Text>
        </View>
        <View
          style={styles.checkRow}
          accessible
          accessibilityLabel={facts.workOrder.state === "open" ? t("rooms.readiness.workOrderOpen", { label: facts.workOrder.label }) : t("rooms.readiness.workOrderNone")}
          testID="readiness-work-order"
        >
          <Ionicons name={facts.workOrder.state === "open" ? "build-outline" : "checkmark-circle-outline"} size={18} color={facts.workOrder.state === "open" ? theme.status.dirty : theme.textMuted} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.checkText, { color: theme.textPrimary }]}>
            {facts.workOrder.state === "open" ? t("rooms.readiness.workOrderOpen", { label: facts.workOrder.label }) : t("rooms.readiness.workOrderNone")}
          </Text>
        </View>
      </View>

      {guidance ? <RoomGuidanceLine line={guidance} /> : null}

      <RoomHelpCard room={room} live={false} variant="before" />

      <Pressable
        onPress={onOpenInfo}
        accessibilityRole="button"
        accessibilityLabel={t("rooms.work.roomInfo.open")}
        style={[styles.infoLink, { borderColor: theme.border, backgroundColor: theme.surface }]}
        testID="open-room-info"
      >
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.infoLinkText, { color: theme.primaryAction }]}>
          {t("rooms.work.roomInfo.open")}
        </Text>
        <Ionicons name="chevron-forward" size={18} color={theme.primaryAction} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 12 },
  card: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 10 },
  eyebrow: { fontSize: 11, fontWeight: "900", letterSpacing: 0.8, textTransform: "uppercase" },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 28 },
  checkText: { flex: 1, fontSize: 15, lineHeight: 21, fontWeight: "600" },
  infoLink: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  infoLinkText: { fontSize: 15, fontWeight: "800" },
});
