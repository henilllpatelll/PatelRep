import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { BottomSheet, MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { useTheme } from "@/lib/theme/useTheme";

export interface Option<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

interface Props<T extends string> {
  visible: boolean;
  title: string;
  options: readonly Option<T>[];
  value: T | null;
  onSelect: (value: T) => void;
  onClose: () => void;
  testID: string;
}

/** A readable single-choice list in a sheet. Used where a row of chips would scroll sideways (category, source, impact). */
export function OptionSheet<T extends string>({ visible, title, options, value, onSelect, onClose, testID }: Props<T>) {
  const theme = useTheme();
  return (
    <BottomSheet visible={visible} title={title} onClose={onClose} testID={testID}>
      <View style={styles.list} accessibilityRole="radiogroup">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              onPress={() => {
                onSelect(option.value);
                onClose();
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={option.hint ? `${option.label}. ${option.hint}` : option.label}
              testID={`${testID}-${option.value}`}
              style={[styles.row, { borderColor: selected ? theme.primaryLine : theme.border, backgroundColor: selected ? theme.primarySoft : theme.surfaceSubtle }]}
            >
              <View style={styles.body}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.label, { color: selected ? theme.primaryAction : theme.textPrimary }]}>
                  {option.label}
                </Text>
                {option.hint ? (
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>
                    {option.hint}
                  </Text>
                ) : null}
              </View>
              {selected ? <Ionicons name="checkmark-circle" size={20} color={theme.primaryAction} /> : null}
            </Pressable>
          );
        })}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  list: { gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 52, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
  body: { flex: 1 },
  label: { fontSize: 15, fontWeight: "700" },
  hint: { fontSize: 12.5, marginTop: 2 },
});
