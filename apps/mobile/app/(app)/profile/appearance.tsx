import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { SettingsScreen } from "@/components/settings/SettingsScreen";
import { useAppearancePreference } from "@/lib/theme/ThemeProvider";
import { useTheme } from "@/lib/theme/useTheme";

export default function AppearanceSettingsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { preference, setPreference } = useAppearancePreference();
  return (
    <SettingsScreen title={t("profile.appearance.label")} back>
      <View
        style={[styles.segmented, { backgroundColor: theme.surfaceMuted, borderColor: theme.borderSubtle }]}
        accessibilityRole="radiogroup"
        accessibilityLabel={t("profile.appearance.label")}
        testID="appearance-segmented"
      >
        {(
          [
            { value: "system" as const, label: t("profile.appearance.system") },
            { value: "light" as const, label: t("profile.appearance.light") },
            { value: "dark" as const, label: t("profile.appearance.dark") },
          ]
        ).map((option) => {
          const active = preference === option.value;
          return (
            <TouchableOpacity
              key={option.value}
              style={[styles.segment, active && { backgroundColor: theme.primaryAction }]}
              onPress={() => void setPreference(option.value)}
              activeOpacity={0.85}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ selected: active }}
              testID={`appearance-${option.value}`}
            >
              <Text
                maxFontSizeMultiplier={1.4}
                style={[styles.segmentText, { color: active ? theme.onPrimary : theme.textSecondary }]}
              >
                {option.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </SettingsScreen>
  );
}

const styles = StyleSheet.create({
  segmented: {
    flexDirection: "row",
    alignSelf: "stretch",
    borderWidth: 1,
    borderRadius: 10,
    padding: 2,
    gap: 2,
  },
  segment: {
    minHeight: 44,
    flex: 1,
    minWidth: 0,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentText: {
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
  },
});
