import { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { supabase } from "@/lib/supabase";
import { useAppStore } from "@/stores/appStore";
import { SettingsScreen } from "@/components/settings/SettingsScreen";
import { useTheme } from "@/lib/theme/useTheme";

export default function LanguageSettingsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { user } = useAppStore();
  const [language, setLanguage] = useState(i18n.language);

  async function selectLanguage(next: "en" | "es") {
    if (next === language) return;
    setLanguage(next);
    await i18n.changeLanguage(next);
    if (user) {
      try {
        await supabase.from("user_profiles").update({ language_pref: next }).eq("id", user.id);
      } catch {
        // Preference still applies locally; profile sync can catch up later.
      }
    }
  }

  return (
    <SettingsScreen title={t("profile.language")} back>
      <View
        style={[styles.segmented, { backgroundColor: theme.surfaceMuted, borderColor: theme.borderSubtle }]}
        accessibilityRole="radiogroup"
        accessibilityLabel={t("profile.language")}
        testID="language-segmented"
      >
        {(
          [
            { code: "en" as const, label: language === "es" ? "Inglés" : "English" },
            { code: "es" as const, label: "Español" },
          ]
        ).map((option) => {
          const active = language === option.code;
          return (
            <TouchableOpacity
              key={option.code}
              style={[styles.segment, active && { backgroundColor: theme.primaryAction }]}
              onPress={() => void selectLanguage(option.code)}
              activeOpacity={0.85}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ selected: active }}
              testID={`language-${option.code}`}
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
