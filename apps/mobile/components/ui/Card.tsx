import { StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { useTheme } from "@/lib/theme/useTheme";

interface CardProps {
  children: React.ReactNode;
  dimmed?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Card — reusable themed surface (bg/border/radius/shadow), extracted from
 * RoomQueueCard's ad-hoc shell (evening.tsx styles.card / cardDimmed).
 * Colors ONLY via useTheme() — never a static token import here. */
export function Card({ children, dimmed = false, style, testID }: CardProps) {
  const theme = useTheme();

  return (
    <View
      testID={testID}
      style={[
        styles.base,
        {
          backgroundColor: dimmed ? theme.surfaceMuted : theme.surface,
          borderColor: theme.border,
          shadowColor: theme.textPrimary,
          shadowOpacity: dimmed ? 0 : 0.06,
          elevation: dimmed ? 0 : 2,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
  },
});
