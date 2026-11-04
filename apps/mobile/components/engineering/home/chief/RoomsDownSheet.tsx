import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { BottomSheet, MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { EngineeringState, StaleBanner } from "@/components/engineering/EngineeringState";
import { Note } from "@/components/engineering/workorder/sheetKit";
import { formatWhen } from "@/components/engineering/rooms/roomUi";
import { resolveLoadState } from "@/lib/engineering/loadState";
import type { ImpactRow } from "@/lib/engineering/roomsDown";
import { useRoomsDown } from "@/lib/engineering/useRoomsDown";
import { useTheme } from "@/lib/theme/useTheme";
import { HOME_MIN_TOUCH } from "../homeStyles";

interface Props {
  visible: boolean;
  onClose: () => void;
  scope: string | null;
  online: boolean;
  locale: string;
  onOpenRoom: (roomId: string | null) => void;
  onOpenWorkOrder: (workOrderId: string) => void;
  onViewAllRooms: () => void;
}

function RoomRow({ row, locale, onOpenRoom, onOpenWorkOrder }: { row: ImpactRow; locale: string; onOpenRoom: Props["onOpenRoom"]; onOpenWorkOrder: Props["onOpenWorkOrder"] }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const type = t(`engRooms.down.types.${row.type}`);
  const eta = row.expectedReturnAt
    ? row.pastEta
      ? t("engRooms.returnOverdue", { time: formatWhen(row.expectedReturnAt, locale) })
      : t("engRooms.expectedBack", { time: formatWhen(row.expectedReturnAt, locale) })
    : t("home.chief.impactNoEta");
  const repairText = row.repair
    ? [row.repair.code, row.repair.title].filter(Boolean).join(" · ") || t("home.chief.impactRepairLinked")
    : t("home.chief.impactNoRepair");
  // The two cases that need a person's decision are said in words, not only colour.
  const note = row.repair == null ? t("home.chief.impactNoRepairHint") : row.repairClosed ? t("home.chief.impactRepairClosedHint") : null;
  const place = [t("workQueue.roomLabel", { room: row.roomNumber }), row.floor != null ? t("home.chief.impactFloor", { floor: row.floor }) : null].filter(Boolean).join(" · ");

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: row.pastEta ? theme.status.dirtyLine : theme.border }]} testID={`impact-${row.periodId}`}>
      <Pressable
        onPress={() => onOpenRoom(row.roomId)}
        accessibilityRole="button"
        accessibilityLabel={`${place}. ${type}. ${row.reason ?? ""}. ${eta}. ${t("home.chief.impactOpenRoom")}`}
        style={styles.main}
        testID={`impact-room-${row.periodId}`}
      >
        <View style={styles.text}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.room, { color: theme.textPrimary }]}>
            {place}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textSecondary }]}>
            {[type, row.reason].filter(Boolean).join(" · ")}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: row.pastEta ? theme.status.dirty : theme.textMuted, fontWeight: row.pastEta ? "700" : "400" }]}>
            {eta}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
      </Pressable>

      {row.repair ? (
        <Pressable
          onPress={() => onOpenWorkOrder(row.repair!.id)}
          accessibilityRole="button"
          accessibilityLabel={`${repairText}. ${t("home.chief.impactOpenRepair")}`}
          style={[styles.repair, { borderTopColor: theme.border }]}
          testID={`impact-repair-${row.periodId}`}
        >
          <Ionicons name="construct-outline" size={16} color={theme.textMuted} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={2} style={[styles.meta, { color: theme.textSecondary, flex: 1 }]}>
            {repairText}
          </Text>
          <Ionicons name="chevron-forward" size={14} color={theme.textMuted} />
        </Pressable>
      ) : (
        <View style={[styles.repair, { borderTopColor: theme.border }]}>
          <Ionicons name="alert-circle-outline" size={16} color={theme.status.dirty} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textSecondary, flex: 1 }]}>
            {repairText}
          </Text>
        </View>
      )}
      {note ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.status.dirty }]} testID={`impact-hint-${row.periodId}`}>
          {note}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Room Impact: the rooms that are down right now, the repair holding each one and when it should be back. Read-only: it
 * opens the existing room and work-order screens, where releasing a room or changing its return time already live. A room is
 * only listed because the server has a confirmed out-of-order / out-of-service period for it, never because it has a repair.
 */
export function RoomsDownSheet({ visible, onClose, scope, online, locale, onOpenRoom, onOpenWorkOrder, onViewAllRooms }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const resource = useRoomsDown(scope, visible);
  const rows = resource.impact?.rows ?? [];
  const state = resolveLoadState({ loading: resource.loading, failure: resource.failure, count: rows.length, offline: !online });
  const unreadable = resource.impact?.unreadable ?? 0;
  const needsDecision = resource.impact?.needsDecision ?? 0;

  return (
    <BottomSheet visible={visible} title={t("home.chief.impactTitle")} onClose={onClose} tall testID="room-impact-sheet">
      <View style={styles.stack}>
        {state.status === "ready" ? (
          <>
            {state.stale ? <StaleBanner onRetry={() => void resource.reload()} /> : null}
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.summary, { color: theme.textPrimary }]} testID="impact-summary">
              {t("home.chief.roomsDownTitle", { count: rows.length })}
              {needsDecision > 0 ? ` · ${t("home.chief.impactNeedsDecision", { count: needsDecision })}` : ""}
            </Text>
            {rows.map((row) => (
              <RoomRow key={row.periodId} row={row} locale={locale} onOpenRoom={onOpenRoom} onOpenWorkOrder={onOpenWorkOrder} />
            ))}
            {unreadable > 0 ? <Note>{t("home.chief.impactUnreadable", { count: unreadable })}</Note> : null}
          </>
        ) : (
          <EngineeringState status={state.status} onRetry={() => void resource.reload()} emptyTitle={t("home.chief.impactEmpty")} emptyBody={t("home.chief.impactEmptyBody")} />
        )}
        <Pressable onPress={onViewAllRooms} accessibilityRole="button" style={styles.viewAll} testID="impact-view-all">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.viewAllText, { color: theme.primaryAction }]}>
            {t("home.chief.impactViewAll")}
          </Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 10 },
  summary: { fontSize: 15, fontWeight: "800" },
  card: { borderWidth: 1, borderRadius: 14, overflow: "hidden" },
  main: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: HOME_MIN_TOUCH + 12, paddingHorizontal: 14, paddingVertical: 12 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  room: { fontSize: 16, fontWeight: "800" },
  meta: { fontSize: 13, lineHeight: 18 },
  repair: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: HOME_MIN_TOUCH, paddingHorizontal: 14, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
  hint: { fontSize: 12.5, lineHeight: 17, fontWeight: "700", paddingHorizontal: 14, paddingBottom: 10 },
  viewAll: { minHeight: HOME_MIN_TOUCH, justifyContent: "center", alignItems: "center" },
  viewAllText: { fontSize: 14, fontWeight: "800" },
});
