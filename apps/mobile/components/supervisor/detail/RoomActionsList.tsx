import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import type { DetailAction, DetailActionKey } from "@/lib/housekeeping/roomDetailView";
import { useTheme } from "@/lib/theme/useTheme";

/* ─── More room actions — the compact list ──────────────────────────────────
   Only actions that apply to this room right now. A change that needs a fresh board is shown disabled with the
   drawer's "paused" banner above explaining why; nothing here is a placeholder for a later feature. */

const ICON: Record<DetailActionKey, React.ComponentProps<typeof Ionicons>["name"]> = {
  assign: "person-add-outline",
  reassign: "swap-horizontal-outline",
  remove: "remove-circle-outline",
  inspect: "shield-checkmark-outline",
};

export function RoomActionsList({ actions, onSelect }: { actions: DetailAction[]; onSelect: (key: DetailActionKey) => void }) {
  const theme = useTheme();
  return (
    <View style={styles.list} testID="room-actions-list">
      {actions.map((action) => {
        const color = action.destructive ? theme.status.dirty : theme.textPrimary;
        return (
          <Pressable
            key={action.key}
            onPress={() => onSelect(action.key)}
            disabled={action.disabled}
            accessibilityRole="button"
            accessibilityLabel={`${action.label}. ${action.hint}`}
            accessibilityState={{ disabled: action.disabled }}
            testID={`room-action-${action.key}`}
            style={({ pressed }) => [
              styles.item,
              { backgroundColor: theme.surface, borderColor: theme.border },
              action.disabled && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons name={ICON[action.key]} size={20} color={action.disabled ? theme.textDisabled : color} />
            <View style={styles.body}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: action.disabled ? theme.textDisabled : color }]}>
                {action.label}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>{action.hint}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 8 },
  item: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 60, borderWidth: 1, borderRadius: R.lg, paddingHorizontal: 14, paddingVertical: 10 },
  body: { flex: 1, minWidth: 0, gap: 1 },
  title: { fontSize: 15, fontWeight: "700" },
  hint: { fontSize: 12.5, lineHeight: 17 },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.85 },
});
