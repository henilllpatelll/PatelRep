import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { Mark } from "@/components/supervisor/assignments/BulkParts";
import { R, monoFont } from "@/components/shared/tokens";
import type { SelectionRowModel } from "@/lib/housekeeping/assignmentBulkView";
import { useTheme } from "@/lib/theme/useTheme";

/* ─── One room in selection mode ────────────────────────────────────────────
   The whole row is ONE checkbox: tapping anywhere toggles it, it is at least 48 dp tall, and its state is spoken
   ("selected", "not selected", "unavailable") as well as drawn. A room that cannot be selected stays in the list
   — dimmed, with the reason in words — so the supervisor sees what is held back instead of wondering. */

interface Props {
  model: SelectionRowModel;
  onToggle: (roomId: string) => void;
}

function SelectableRoomRowView({ model, onToggle }: Props) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => onToggle(model.roomId)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: model.selected, disabled: !model.selectable }}
      accessibilityLabel={model.a11yLabel}
      testID={`bulk-row-${model.roomNumber}`}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: model.selected ? theme.surface : model.selectable ? theme.surface : theme.surfaceMuted, borderColor: model.selected ? theme.primaryAction : theme.borderSubtle },
        pressed && model.selectable && { opacity: 0.85 },
      ]}
    >
      <Mark checked={model.selected} disabled={!model.selectable} />
      <View style={styles.body}>
        <View style={styles.top}>
          <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={[styles.number, { color: model.selectable ? theme.textPrimary : theme.textMuted }]} testID={`bulk-row-number-${model.roomNumber}`}>
            {model.roomNumber}
          </Text>
          {model.chips.map((chip) => (
            <Text key={chip.key} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.chip, { color: chip.tone === "alert" ? theme.destructiveAction : theme.textPrimary, borderColor: chip.tone === "alert" ? theme.destructiveAction : theme.border }]}>
              {chip.label}
            </Text>
          ))}
        </View>
        {model.location || model.detail ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={2} style={[styles.meta, { color: theme.textSecondary }]}>
            {[model.location, model.detail].filter(Boolean).join(" · ")}
          </Text>
        ) : null}
        {model.reason ? (
          <View style={styles.reason} testID={`bulk-row-reason-${model.roomNumber}`}>
            <Ionicons name="information-circle-outline" size={14} color={theme.textMuted} />
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.reasonText, { color: theme.textSecondary }]}>
              {model.reason}
            </Text>
          </View>
        ) : null}
        {model.inDraft ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.inDraft, { color: theme.primaryAction }]} testID={`bulk-row-draft-${model.roomNumber}`}>
            {model.inDraft}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/** Re-renders only when something the row draws changed (its `signature`), so a long list stays smooth. */
export const SelectableRoomRow = memo(SelectableRoomRowView, (prev, next) => prev.model.signature === next.model.signature && prev.onToggle === next.onToggle);

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12, minHeight: MIN_TARGET + 8, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1.5, borderRadius: R.lg },
  body: { flex: 1, minWidth: 0, gap: 3 },
  top: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  number: { fontFamily: monoFont, fontSize: 22, lineHeight: 26, fontWeight: "800" },
  chip: { fontSize: 12, fontWeight: "700", borderWidth: 1, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 1, overflow: "hidden" },
  meta: { fontSize: 13.5, lineHeight: 19 },
  reason: { flexDirection: "row", alignItems: "flex-start", gap: 5 },
  reasonText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: "600" },
  inDraft: { fontSize: 12.5, fontWeight: "700" },
});
