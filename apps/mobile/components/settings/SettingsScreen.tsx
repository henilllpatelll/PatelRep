import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MIN_TOUCH } from "@/lib/settings/a11y";
import { useTheme } from "@/lib/theme/useTheme";

interface SettingsScreenProps {
  title: string;
  /** Child screens show a back button; the root Settings screen does not. */
  back?: boolean;
  children: React.ReactNode;
}

function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace("/(app)/profile" as never);
}

/** Shared chrome for every Settings screen: safe-area header with title (and back), scrolling body. */
export function SettingsScreen({ title, back, children }: SettingsScreenProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <View
        style={[
          styles.header,
          { paddingTop: insets.top + 8, backgroundColor: theme.background, borderBottomColor: theme.borderSubtle },
        ]}
      >
        {back ? (
          <Pressable
            onPress={goBack}
            accessibilityRole="button"
            accessibilityLabel={t("settings.back")}
            hitSlop={8}
            style={styles.back}
            testID="settings-back"
          >
            <Ionicons name="chevron-back" size={24} color={theme.textPrimary} />
          </Pressable>
        ) : null}
        <Text
          maxFontSizeMultiplier={1.4}
          accessibilityRole="header"
          numberOfLines={2}
          style={[styles.title, { color: theme.textPrimary }]}
          testID="settings-title"
        >
          {title}
        </Text>
      </View>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: { width: MIN_TOUCH, height: MIN_TOUCH, alignItems: "center", justifyContent: "center", marginLeft: -4 },
  title: { flex: 1, fontSize: 24, fontWeight: "700", paddingHorizontal: 6 },
  content: { paddingHorizontal: 16, paddingTop: 16, gap: 20 },
});
