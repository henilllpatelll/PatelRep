import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/lib/theme/useTheme";

const MAX_FONT_SCALE = 1.4;

interface SettingsDetailRowProps {
  label: string;
  value: string;
  /** Hotel-managed: shows a lock, no chevron, and is not pressable. */
  locked?: boolean;
  /** Spoken in place of the default label+value when the row is editable. */
  hint?: string;
  onPress?: () => void;
  first?: boolean;
  testID?: string;
}

/** Label-over-value row for profile details. Values wrap, so long names and emails never overflow. */
export function SettingsDetailRow({ label, value, locked, hint, onPress, first, testID }: SettingsDetailRowProps) {
  const theme = useTheme();
  const body = (
    <>
      <View style={styles.text}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.label, { color: theme.textMuted }]}>
          {label}
        </Text>
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={[styles.value, { color: theme.textPrimary }]}
          testID={testID ? `${testID}-value` : undefined}
        >
          {value}
        </Text>
      </View>
      {locked ? <Ionicons name="lock-closed-outline" size={16} color={theme.textDisabled} /> : null}
      {onPress ? <Ionicons name="chevron-forward" size={16} color={theme.textDisabled} /> : null}
    </>
  );
  const rowStyle = [
    styles.row,
    !first && { borderTopColor: theme.borderSubtle, borderTopWidth: StyleSheet.hairlineWidth },
  ];
  if (!onPress) {
    return (
      <View
        style={rowStyle}
        accessible
        accessibilityLabel={`${label}, ${value}`}
        accessibilityHint={locked ? hint : undefined}
        testID={testID}
      >
        {body}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${value}`}
      accessibilityHint={hint}
      testID={testID}
      style={({ pressed }) => [rowStyle, pressed && { backgroundColor: theme.surfaceMuted }]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 60, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 10 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  label: { fontSize: 12, fontWeight: "600" },
  value: { fontSize: 15.5, fontWeight: "600" },
});
