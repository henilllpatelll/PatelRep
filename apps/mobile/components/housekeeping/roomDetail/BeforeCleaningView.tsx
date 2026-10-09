import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import type { Room } from "@/stores/appStore";
import { buildEntryChecks, type RoomDetailView } from "@/lib/housekeeping/roomDetailState";
import { formatClock, type TextContext } from "@/lib/housekeeping/myRoomsText";
import { RushPriorityPanel } from "@/components/housekeeping/RushPriorityPanel";
import { RecleanCorrectionsPanel } from "@/components/housekeeping/RecleanCorrectionsPanel";
import { RoomStatusNotice } from "./RoomStatusNotice";
import { MAX_FONT_SCALE } from "./BottomSheet";

interface Props {
  room: Room;
  view: RoomDetailView;
  ctx: TextContext;
  /** Set when a non-blocking restriction note applies (e.g. the agreed retry time has arrived). */
  restriction?: ReactNode;
  onOpenInfo: () => void;
}

/**
 * Ready / reclean before the first tap: what the housekeeper needs to decide
 * whether to go in — deadline, the pre-entry facts, one warning — and nothing
 * else. Reservation detail lives behind Room Information.
 */
export function BeforeCleaningView({ room, view, ctx, restriction, onOpenInfo }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const checks = buildEntryChecks(room);
  const reclean = view.kind === "reclean";

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
      </View>

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
