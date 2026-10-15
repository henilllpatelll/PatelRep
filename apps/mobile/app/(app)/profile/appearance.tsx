import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { SettingsChoiceRow } from "@/components/settings/SettingsChoiceRow";
import { SettingsScreen } from "@/components/settings/SettingsScreen";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { useAppearancePreference } from "@/lib/theme/ThemeProvider";
import type { AppearancePreference } from "@/lib/theme/appearance";
import { useTheme } from "@/lib/theme/useTheme";
import { SETTINGS_MAX_FONT_SCALE as MAX_FONT_SCALE } from "@/lib/settings/a11y";

const OPTIONS: { value: AppearancePreference; icon: "phone-portrait-outline" | "sunny-outline" | "moon-outline" }[] = [
  { value: "system", icon: "phone-portrait-outline" },
  { value: "light", icon: "sunny-outline" },
  { value: "dark", icon: "moon-outline" },
];

export default function AppearanceSettingsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { preference, setPreference } = useAppearancePreference();
  return (
    <SettingsScreen title={t("profile.appearance.label")} back>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.intro, { color: theme.textMuted }]}>
        {t("profile.appearance.intro")}
      </Text>
      <SettingsSection testID="appearance-options">
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel={t("profile.appearance.label")}
          testID="appearance-group"
        >
          {OPTIONS.map((option, index) => (
            <SettingsChoiceRow
              key={option.value}
              first={index === 0}
              icon={option.icon}
              label={t(`profile.appearance.${option.value}`)}
              hint={t(`profile.appearance.${option.value}Hint`)}
              selected={preference === option.value}
              onPress={() => void setPreference(option.value)}
              testID={`appearance-${option.value}`}
            />
          ))}
        </View>
      </SettingsSection>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textMuted }]}>
        {t("profile.appearance.note")}
      </Text>
    </SettingsScreen>
  );
}

const styles = StyleSheet.create({
  intro: { fontSize: 14, lineHeight: 20, paddingHorizontal: 4 },
  note: { fontSize: 12.5, lineHeight: 17, paddingHorizontal: 4 },
});
