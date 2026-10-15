import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";

/** Honest placeholder for a Settings destination whose controls ship in a later phase. */
export function NotConfiguredNotice({ message }: { message?: string }) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <View
      style={[styles.box, { backgroundColor: theme.surfaceMuted, borderColor: theme.borderSubtle }]}
      accessibilityRole="summary"
      testID="settings-not-configured"
    >
      <Ionicons name="construct-outline" size={20} color={theme.textMuted} />
      <Text maxFontSizeMultiplier={1.4} style={[styles.text, { color: theme.textSecondary }]}>
        {message ?? t("settings.notConfigured")}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 14, padding: 14 },
  text: { flex: 1, fontSize: 14, lineHeight: 20 },
});
