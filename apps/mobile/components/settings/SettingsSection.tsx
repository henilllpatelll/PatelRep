import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/lib/theme/useTheme";

interface SettingsSectionProps {
  title?: string;
  children: React.ReactNode;
  testID?: string;
}

/** Titled group of rows on a single bordered surface. */
export function SettingsSection({ title, children, testID }: SettingsSectionProps) {
  const theme = useTheme();
  return (
    <View style={styles.wrap} testID={testID}>
      {title ? (
        <Text
          maxFontSizeMultiplier={1.4}
          accessibilityRole="header"
          style={[styles.title, { color: theme.textMuted }]}
        >
          {title}
        </Text>
      ) : null}
      <View style={[styles.group, { backgroundColor: theme.surface, borderColor: theme.border }]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  title: { fontSize: 12, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase", paddingHorizontal: 4 },
  group: { borderWidth: 1, borderRadius: 16, overflow: "hidden" },
});
