import { Pressable, StyleSheet, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import type { SyncStatus } from "@/lib/engineering/homeModel";
import { HOME_MAX_FONT } from "./homeStyles";

export interface HomeConnection {
  status: SyncStatus;
  /** The work queue loaded at least once, so a failed refresh still has data to fall back to. */
  hasQueue: boolean;
}

type IconName = React.ComponentProps<typeof Ionicons>["name"];

/** The one-line sync/connection state under the header. "Synced" is only said after a read actually succeeded. */
export function HomeConnectionStatus({ connection, onPress }: { connection: HomeConnection; onPress: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { status, hasQueue } = connection;
  const minutes = status.minutes ?? 0;
  const ago = minutes < 1 ? t("home.engineer.syncJustNow") : t("home.engineer.syncMinutes", { minutes });
  const text = (() => {
    switch (status.kind) {
      case "offline":
        return status.minutes != null ? t("home.engineer.syncOfflineSince", { ago }) : t("home.engineer.syncOffline");
      case "syncing":
        return t("home.engineer.syncSyncing");
      case "failed":
        return hasQueue ? t("home.engineer.syncFailed") : t("home.engineer.syncFailedEmpty");
      case "pending":
        return t("home.engineer.syncPending", { count: status.pending });
      case "unsynced":
        return t("home.engineer.syncNone");
      default:
        return t("home.engineer.syncDone", { ago });
    }
  })();
  const icon: IconName =
    status.kind === "synced" ? "checkmark-circle-outline" : status.kind === "offline" ? "cloud-offline-outline" : status.kind === "syncing" ? "sync-outline" : "alert-circle-outline";
  return (
    <Pressable
      style={styles.row}
      accessibilityLiveRegion="polite"
      accessibilityRole="button"
      accessibilityLabel={text}
      accessibilityHint={t("engineeringSync.openHint")}
      onPress={onPress}
      hitSlop={8}
      testID="engineer-sync"
    >
      <Ionicons name={icon} size={13} color={theme.shell.ink3} />
      <Text maxFontSizeMultiplier={HOME_MAX_FONT} style={[styles.text, { color: theme.shell.ink3 }]}>
        {text}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, minHeight: 24 },
  text: { fontSize: 12.5, flexShrink: 1 },
});
