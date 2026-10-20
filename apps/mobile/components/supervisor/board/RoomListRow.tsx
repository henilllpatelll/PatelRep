import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { getStatusMeta, StatusRail } from "@/components/shared/evening";
import { R, monoFont } from "@/components/shared/tokens";
import type { ResultRowModel } from "@/lib/housekeeping/roomBoardView";
import { useTheme } from "@/lib/theme/useTheme";

/* ─── Result row — the compact list form of a room ──────────────────────────
   Used for search results, small filtered sets and the flat sort modes, where rooms are not grouped under a
   floor heading. Same facts and the same protected status colours as the grid card, plus where the room is.
   The whole row is one tap target that opens the existing room sheet. */

interface Props {
  model: ResultRowModel;
  onSelect: (roomId: string) => void;
}

function RoomListRowView({ model, onSelect }: Props) {
  const theme = useTheme();
  const meta = getStatusMeta(model.rawStatus, theme);
  const unavailable = model.stage === "unavailable";
  const needsPerson = model.assignee.kind === "none" && model.stage === "to_clean";
  const assigneeColor = needsPerson ? theme.status.dirty : model.assignee.kind === "none" ? theme.textMuted : theme.textSecondary;

  return (
    <Pressable
      onPress={() => onSelect(model.roomId)}
      accessibilityRole="button"
      accessibilityLabel={model.accessibilityLabel}
      testID={`board-result-${model.roomNumber}`}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: unavailable ? theme.surfaceMuted : theme.surface, borderColor: theme.borderSubtle },
        pressed && { opacity: 0.85 },
      ]}
    >
      <StatusRail status={model.rawStatus} />
      <View style={styles.body}>
        <View style={styles.numberCol}>
          <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={[styles.number, { color: theme.textPrimary }]} testID={`board-result-number-${model.roomNumber}`}>
            {model.roomNumber}
          </Text>
          <View style={styles.flags} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {model.flags.vip ? <Ionicons name="star" size={12} color={theme.status.pickup} /> : null}
            {model.flags.dnd ? <Ionicons name="moon" size={12} color={theme.textMuted} /> : null}
            {model.flags.workOrder ? <Ionicons name="construct" size={12} color={theme.status.pickup} /> : null}
          </View>
        </View>
        <View style={styles.main}>
          <View style={styles.statusLine}>
            <View style={[styles.pill, { backgroundColor: meta.bg, borderColor: meta.border }]} testID={`board-result-status-${model.roomNumber}`}>
              <Ionicons name={model.icon} size={12} color={meta.fg} />
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={1} style={[styles.pillText, { color: meta.fg }]}>
                {model.statusLabel}
              </Text>
            </View>
            {model.assignee.text ? (
              <Text
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                numberOfLines={1}
                style={[styles.assignee, { color: assigneeColor }, needsPerson && styles.assigneeStrong]}
                testID={`board-result-assignee-${model.roomNumber}`}
              >
                {model.assignee.text}
              </Text>
            ) : null}
          </View>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={2} style={[styles.detail, { color: theme.textMuted }]} testID={`board-result-detail-${model.roomNumber}`}>
            {model.details.join(" · ")}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={1} style={[styles.location, { color: theme.textMuted }]} testID={`board-result-location-${model.roomNumber}`}>
            {model.location}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
      </View>
    </Pressable>
  );
}

export const RoomListRow = memo(RoomListRowView, (prev, next) => prev.model.signature === next.model.signature && prev.onSelect === next.onSelect);

const styles = StyleSheet.create({
  row: { minHeight: 76, overflow: "hidden", borderWidth: 1, borderRadius: R.lg },
  body: { flexDirection: "row", alignItems: "center", gap: 12, paddingLeft: 14, paddingRight: 12, paddingVertical: 10 },
  numberCol: { minWidth: 56, gap: 4 },
  number: { fontFamily: monoFont, fontSize: 22, lineHeight: 26, fontWeight: "800" },
  flags: { flexDirection: "row", gap: 5 },
  main: { flex: 1, minWidth: 0, gap: 3 },
  statusLine: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  pill: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  pillText: { fontSize: 10.5, fontWeight: "800", letterSpacing: 0.4, textTransform: "uppercase" },
  assignee: { flexShrink: 1, fontSize: 13, fontWeight: "600" },
  assigneeStrong: { fontWeight: "800" },
  detail: { fontSize: 12.5, lineHeight: 17 },
  location: { fontSize: 11.5 },
});
