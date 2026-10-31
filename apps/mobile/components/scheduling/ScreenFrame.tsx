import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { useTheme } from "@/lib/theme/useTheme";

/** The bar every Phase 5 secondary screen shares: back, an optional kicker, the title. Not a tab. */
export function ScreenFrame({ title, kicker, fallback, testID, children }: { title: string; kicker?: string; fallback: string; testID: string; children: ReactNode }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const back = () => {
    if (router.canGoBack()) router.back();
    else router.replace(fallback as never);
  };
  return (
    <View style={[styles.container, { backgroundColor: theme.background }]} testID={testID}>
      <View style={[styles.bar, { paddingTop: insets.top + 8, borderBottomColor: theme.borderSubtle, backgroundColor: theme.background }]}>
        <Pressable onPress={back} accessibilityRole="button" accessibilityLabel={t("common.back")} testID={`${testID}-back`} style={styles.backHit}>
          <Ionicons name="chevron-back" size={24} color={theme.textPrimary} />
        </Pressable>
        <View style={styles.titles}>
          {kicker ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.kicker, { color: theme.textMuted }]}>
              {kicker}
            </Text>
          ) : null}
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]}>
            {title}
          </Text>
        </View>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  bar: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  backHit: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  titles: { flex: 1, minWidth: 0 },
  kicker: { fontSize: 12, fontWeight: "800", letterSpacing: 0.5 },
  title: { fontSize: 22, fontWeight: "800" },
});
