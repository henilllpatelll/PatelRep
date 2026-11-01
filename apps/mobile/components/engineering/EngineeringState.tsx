import type { ComponentProps } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { StateBlock } from "@/components/ui/StateBlock";
import { useTheme } from "@/lib/theme/useTheme";
import type { EngineeringLoadStatus } from "@/lib/engineering/loadState";

type IconName = ComponentProps<typeof Ionicons>["name"];

interface Props {
  /** Anything but "ready" renders a block; "ready" renders nothing so callers can show their list instead. */
  status: EngineeringLoadStatus;
  onRetry?: () => void;
  emptyIcon?: IconName;
  emptyTitle: string;
  emptyBody?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * The one loading / empty / error / forbidden / offline block for engineering lists.
 * A failed request is always an error block with Retry — never the empty state.
 */
export function EngineeringState({ status, onRetry, emptyIcon, emptyTitle, emptyBody, style }: Props) {
  const { t } = useTranslation();
  switch (status) {
    case "ready":
      return null;
    case "loading":
      return <StateBlock status="loading" style={style} />;
    case "empty":
      return <StateBlock status="empty" emptyIcon={emptyIcon} emptyTitle={emptyTitle} emptyBody={emptyBody} style={style} />;
    case "forbidden":
      return (
        <StateBlock
          status="error"
          errorIcon="lock-closed-outline"
          errorMessage={t("engineeringState.forbidden")}
          style={style}
        />
      );
    case "offline":
      return (
        <StateBlock
          status="error"
          errorIcon="cloud-offline-outline"
          errorMessage={t("engineeringState.offline")}
          onRetry={onRetry}
          retryLabel={t("common.retry")}
          style={style}
        />
      );
    case "error":
    default:
      return (
        <StateBlock
          status="error"
          errorMessage={t("engineeringState.loadFailed")}
          onRetry={onRetry}
          retryLabel={t("common.retry")}
          style={style}
        />
      );
  }
}

/** Shown above still-visible data when the latest refresh failed, so stale rows are never mistaken for current ones. */
export function StaleBanner({ onRetry }: { onRetry?: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <View
      accessibilityRole="alert"
      style={[styles.banner, { backgroundColor: theme.status.pickupSoft, borderColor: theme.status.pickupLine }]}
      testID="engineering-stale-banner"
    >
      <Ionicons name="alert-circle-outline" size={16} color={theme.status.pickup} />
      <Text style={[styles.text, { color: theme.status.pickup }]}>{t("engineeringState.stale")}</Text>
      {onRetry ? (
        <Text
          accessibilityRole="button"
          onPress={onRetry}
          style={[styles.retry, { color: theme.status.pickup }]}
        >
          {t("common.retry")}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  text: { flex: 1, fontSize: 12.5, fontWeight: "600" },
  retry: { fontSize: 12.5, fontWeight: "800", textDecorationLine: "underline", paddingVertical: 6 },
});
