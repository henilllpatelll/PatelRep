import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { radiusV2, touchV2 } from "@/components/shared/tokensV2";
import { useTheme } from "@/lib/theme/useTheme";
import { AppText } from "./AppText";

export interface SegmentOption<K extends string> {
  key: K;
  label: string;
}

export interface SegmentedControlProps<K extends string> {
  options: ReadonlyArray<SegmentOption<K>>;
  value: K;
  onChange: (key: K) => void;
  /** Names the whole group for screen readers, e.g. "Appearance". */
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** SegmentedControl: 2 to 4 mutually exclusive views. The selected segment is a raised surface
 *  with bolder text (not only a color change). Each segment is >=44dp tall and wraps long
 *  (Spanish) labels onto two lines rather than truncating. */
export function SegmentedControl<K extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  style,
  testID,
}: SegmentedControlProps<K>) {
  const theme = useTheme();
  return (
    <View
      testID={testID}
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      style={[styles.track, { backgroundColor: theme.surfaceMuted }, style]}
    >
      {options.map((option) => {
        const selected = option.key === value;
        return (
          <Pressable
            key={option.key}
            testID={testID ? `${testID}-${option.key}` : undefined}
            onPress={() => onChange(option.key)}
            accessibilityRole="tab"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            style={[
              styles.segment,
              selected
                ? { backgroundColor: theme.surface, borderColor: theme.borderSubtle, borderWidth: 1 }
                : { borderWidth: 1, borderColor: "transparent" },
            ]}
          >
            <AppText
              variant="label"
              tone={selected ? "primary" : "secondary"}
              style={[styles.label, selected ? styles.selectedLabel : null]}
              maxFontSizeMultiplier={1.6}
            >
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: "row",
    borderRadius: radiusV2.control,
    padding: 3,
    gap: 2,
  },
  segment: {
    flex: 1,
    minHeight: touchV2.min,
    borderRadius: radiusV2.input,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  label: { textAlign: "center" },
  selectedLabel: { fontWeight: "700" },
});
