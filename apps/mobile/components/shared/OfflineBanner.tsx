import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { useIsDesignV2 } from "@/lib/design/DesignV2Scope";
import { useTheme } from "@/lib/theme/useTheme";
import { useAppStore } from "@/stores/appStore";

export function OfflineBanner() {
  const isOnline = useAppStore((s) => s.isOnline);
  const theme = useTheme();
  const { t } = useTranslation();
  const v2 = useIsDesignV2();
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
      {v2 ? (
        <Ionicons name="cloud-offline-outline" size={16} color={theme.banner.offline.foreground} accessible={false} />
      ) : null}
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
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
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
