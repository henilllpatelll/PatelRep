import { StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { useTheme } from "@/lib/theme/useTheme";
import { darkThemeV2, elevationV2, radiusV2 } from "@/components/shared/tokensV2";
import { useIsDesignV2 } from "@/lib/design/DesignV2Scope";

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
  const v2 = useIsDesignV2();

  if (v2) {
    // V2: subtle separator edge, 16px radius, restrained shadow (none in dark).
    return (
      <View
        testID={testID}
        style={[
          styles.base,
          {
            backgroundColor: dimmed ? theme.surfaceMuted : theme.surface,
            borderColor: theme.borderSubtle,
            borderRadius: radiusV2.card,
            shadowColor: "#0D1728",
            ...(dimmed || (theme as unknown) === darkThemeV2 ? elevationV2.dark.card : elevationV2.light.card),
          },
          style,
        ]}
      >
        {children}
      </View>
    );
  }

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
