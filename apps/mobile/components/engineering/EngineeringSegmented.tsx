import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/lib/theme/useTheme";

export interface SegmentOption<K extends string> {
  key: K;
  label: string;
  testID?: string;
}

interface Props<K extends string> {
  options: readonly SegmentOption<K>[];
  value: K;
  onChange: (key: K) => void;
  accessibilityLabel?: string;
  /** Smaller control for a subview selector nested under a primary one. */
  compact?: boolean;
}

/** The Engineering view selector (PM Today | Plan | History, Plan Week | Calendar). One tab stop per option, 40pt+ targets. */
export function EngineeringSegmented<K extends string>({ options, value, onChange, accessibilityLabel, compact = false }: Props<K>) {
  const theme = useTheme();
  return (
    <View style={[styles.track, { backgroundColor: theme.surfaceSubtle }]} accessibilityRole="tablist" accessibilityLabel={accessibilityLabel}>
      {options.map((option) => {
        const active = option.key === value;
        return (
          <Pressable
            key={option.key}
            onPress={() => onChange(option.key)}
            style={[styles.segment, compact && styles.compact, active && { backgroundColor: theme.surface, borderColor: theme.border }]}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            testID={option.testID}
          >
            <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={[styles.label, { color: active ? theme.textPrimary : theme.textMuted }]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: "row", borderRadius: 12, padding: 3, gap: 3 },
  segment: { flex: 1, minHeight: 40, borderRadius: 9, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "transparent", paddingHorizontal: 6 },
  compact: { minHeight: 36 },
  label: { fontSize: 13, fontWeight: "700" },
});
