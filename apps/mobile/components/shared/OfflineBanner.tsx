import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { useAppStore } from "@/stores/appStore";

export function OfflineBanner() {
  const isOnline = useAppStore((s) => s.isOnline);
  const theme = useTheme();
  const { t } = useTranslation();
  if (isOnline) return null;

  const message = t("common.offline");

  return (
    <View
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      accessibilityLabel={message}
      style={[
        styles.banner,
        {
          backgroundColor: theme.banner.offline.background,
          borderColor: theme.banner.offline.border,
        },
      ]}
    >
      <Text
        accessible={false}
        style={[styles.text, { color: theme.banner.offline.foreground }]}
      >
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    alignItems: "center",
    borderBottomWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 8,
    width: "100%",
  },
  text: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
    textAlign: "center",
  },
});
