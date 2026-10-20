import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { getStatusMeta, StatusRail } from "@/components/shared/evening";
import { R, monoFont } from "@/components/shared/tokens";
import { GRID_GAP, type RoomTileModel } from "@/lib/housekeeping/roomBoardView";
import { useTheme } from "@/lib/theme/useTheme";

/* ─── Room card — the readable board cell ───────────────────────────────────
   Room number, a labelled status (icon + text, never colour alone), who has it, and one or two recorded
   details. The whole card is the one tap target. Status colours come from the protected `getStatusMeta`
   mapping, so a status means the same colour here as on every other screen. */

interface TileProps {
  model: RoomTileModel;
  onSelect: (roomId: string) => void;
}

function RoomTileView({ model, onSelect }: TileProps) {
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
      testID={`board-tile-${model.roomNumber}`}
      style={({ pressed }) => [
        styles.tile,
        { backgroundColor: unavailable ? theme.surfaceMuted : theme.surface, borderColor: theme.borderSubtle },
        pressed && styles.pressed,
      ]}
    >
      <StatusRail status={model.rawStatus} />
      <View style={styles.body}>
        <View style={styles.topRow}>
          <Text
            maxFontSizeMultiplier={1.3}
            numberOfLines={1}
            style={[styles.number, { color: theme.textPrimary }]}
            testID={`board-tile-number-${model.roomNumber}`}
          >
            {model.roomNumber}
          </Text>
          <View style={styles.flags} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {model.flags.vip ? <Ionicons name="star" size={12} color={theme.status.pickup} /> : null}
            {model.flags.dnd ? <Ionicons name="moon" size={12} color={theme.textMuted} /> : null}
            {model.flags.workOrder ? <Ionicons name="construct" size={12} color={theme.status.pickup} /> : null}
            {model.flags.note ? <Ionicons name="chatbox-ellipses" size={12} color={theme.status.clean} /> : null}
          </View>
        </View>

        <View
          style={[styles.pill, { backgroundColor: meta.bg, borderColor: meta.border }]}
          testID={`board-tile-status-${model.roomNumber}`}
        >
          <Ionicons name={model.icon} size={12} color={meta.fg} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={1} style={[styles.pillText, { color: meta.fg }]}>
            {model.statusLabel}
          </Text>
        </View>

        {model.assignee.text ? (
          <View style={styles.assigneeRow}>
            <Ionicons
              name={needsPerson ? "person-add-outline" : "person-outline"}
              size={13}
              color={assigneeColor}
            />
            <Text
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              numberOfLines={1}
              style={[styles.assignee, { color: assigneeColor }, needsPerson && styles.assigneeStrong]}
              testID={`board-tile-assignee-${model.roomNumber}`}
            >
              {model.assignee.text}
            </Text>
          </View>
        ) : null}

        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          numberOfLines={2}
          style={[styles.detail, { color: theme.textMuted }]}
          testID={`board-tile-detail-${model.roomNumber}`}
        >
          {model.details.join(" · ")}
        </Text>
      </View>
    </Pressable>
  );
}

/** Re-renders only when something the card shows changed, so a realtime update repaints just the rooms it touched. */
export const RoomTile = memo(
  RoomTileView,
  (prev, next) => prev.model.signature === next.model.signature && prev.onSelect === next.onSelect,
);

/** One grid row: `columns` cells, padded with empty cells so the last row keeps the same card width. */
export function RoomTileRow({
  models,
  columns,
  onSelect,
}: {
  models: RoomTileModel[];
  columns: number;
  onSelect: (roomId: string) => void;
}) {
  const spacers = Math.max(0, columns - models.length);
  return (
    <View style={styles.row} testID="board-row">
      {models.map((model) => (
        <View key={model.roomId} style={styles.cell}>
          <RoomTile model={model} onSelect={onSelect} />
        </View>
      ))}
      {Array.from({ length: spacers }, (_, index) => (
        <View key={`spacer-${index}`} style={styles.cell} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: GRID_GAP, alignItems: "stretch" },
  cell: { flex: 1, minWidth: 0 },
  tile: {
    flex: 1,
    minHeight: 116,
    overflow: "hidden",
    borderWidth: 1,
    borderRadius: R.lg,
  },
  pressed: { opacity: 0.85 },
  body: { paddingLeft: 14, paddingRight: 10, paddingVertical: 10, gap: 6 },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6 },
  number: { flexShrink: 1, fontFamily: monoFont, fontSize: 22, lineHeight: 26, fontWeight: "800" },
  flags: { flexDirection: "row", alignItems: "center", gap: 5 },
  pill: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  pillText: { flexShrink: 1, fontSize: 10.5, fontWeight: "800", letterSpacing: 0.4, textTransform: "uppercase" },
  assigneeRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  assignee: { flex: 1, minWidth: 0, fontSize: 13, fontWeight: "600" },
  assigneeStrong: { fontWeight: "800" },
  detail: { fontSize: 12, lineHeight: 16 },
});
