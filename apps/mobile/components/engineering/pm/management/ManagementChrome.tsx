import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { useTheme } from "@/lib/theme/useTheme";
import { useV2Text } from "@/lib/design/housekeeperV2";

/** Header shared by every PM management screen: back, title, optional subtitle. */
export function ManagementHeader({ title, subtitle, testID }: { title: string; subtitle?: string; testID: string }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor: theme.shell.bg }]}>
      <Pressable onPress={() => router.back()} style={styles.back} accessibilityRole="button" accessibilityLabel={t("common.back")} testID={`${testID}-back`}>
        <Ionicons name="chevron-back" size={24} color={theme.shell.ink} />
      </Pressable>
      <View style={styles.copy}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.shell.ink }]} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sub, { color: theme.shell.ink3 }]} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: { label: string; onPress: () => void; testID?: string } }) {
  const theme = useTheme();
  const x = useV2Text();
  return (
    <View style={styles.sectionRow}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.section, x.label, { color: theme.textMuted }]} accessibilityRole="header">
        {children}
      </Text>
      {action ? (
        <Pressable onPress={action.onPress} accessibilityRole="button" hitSlop={8} style={styles.sectionAction} testID={action.testID}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sectionActionText, { color: theme.primaryAction }]}>
            {action.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingBottom: 12 },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, gap: 2 },
  title: { fontSize: 20, fontWeight: "700" },
  sub: { fontSize: 13 },
  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 },
  section: { fontSize: 12, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" },
  sectionAction: { minHeight: 32, justifyContent: "center" },
  sectionActionText: { fontSize: 13, fontWeight: "700" },
});
