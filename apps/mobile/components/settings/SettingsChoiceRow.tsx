import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/lib/theme/useTheme";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

const MAX_FONT_SCALE = 1.4;

interface SettingsChoiceRowProps {
  label: string;
  hint?: string;
  icon?: IconName;
  selected: boolean;
  onPress: () => void;
  first?: boolean;
  testID?: string;
}

/** One option in a pick-one list: label, optional hint, and a check (not only a colour) when chosen. */
export function SettingsChoiceRow({ label, hint, icon, selected, onPress, first, testID }: SettingsChoiceRowProps) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={[label, hint].filter(Boolean).join(", ")}
      testID={testID}
      android_ripple={{ color: theme.borderSubtle }}
      style={({ pressed }) => [
        styles.row,
        !first && { borderTopColor: theme.borderSubtle, borderTopWidth: StyleSheet.hairlineWidth },
        pressed && { backgroundColor: theme.surfaceMuted },
      ]}
    >
      {icon ? (
        <View style={[styles.iconTile, { backgroundColor: theme.primarySoft }]}>
          <Ionicons name={icon} size={18} color={theme.primary} />
        </View>
      ) : null}
      <View style={styles.text}>
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={[styles.label, { color: theme.textPrimary, fontWeight: selected ? "700" : "600" }]}
        >
          {label}
        </Text>
        {hint ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>
            {hint}
          </Text>
        ) : null}
      </View>
      {selected ? (
        <Ionicons name="checkmark-circle" size={22} color={theme.primary} testID={testID ? `${testID}-check` : undefined} />
      ) : (
        <View style={[styles.empty, { borderColor: theme.border }]} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  iconTile: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  text: { flex: 1, minWidth: 0, gap: 1 },
  label: { fontSize: 15 },
  hint: { fontSize: 12.5, lineHeight: 17 },
  empty: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5 },
});
