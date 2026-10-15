import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { SettingsScreen } from "@/components/settings/SettingsScreen";
import { useAppStore } from "@/stores/appStore";
import { useTheme } from "@/lib/theme/useTheme";

export default function SyncSettingsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { isOnline, pendingActions, flushQueue } = useAppStore();
  const [syncing, setSyncing] = useState(false);
  const pendingCount = pendingActions.length;

  async function syncNow() {
    if (syncing) return;
    setSyncing(true);
    try {
      await flushQueue();
    } finally {
      setSyncing(false);
    }
  }

  return (
    <SettingsScreen title={t("settings.sync.title")} back>
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]} testID="row-sync">
        <Ionicons
          name={pendingCount > 0 ? "cloud-upload-outline" : "cloud-done-outline"}
          size={22}
          color={theme.primary}
        />
        <View style={styles.text}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.label, { color: theme.textPrimary }]}>
            {t("profile.offlineChanges")}
          </Text>
          <Text maxFontSizeMultiplier={1.4} style={[styles.value, { color: theme.textMuted }]}>
            {pendingCount > 0 ? t("profile.pendingChanges", { count: pendingCount }) : t("profile.upToDate")}
          </Text>
        </View>
        {pendingCount > 0 && isOnline ? (
          <Button
            label={t("profile.syncNow")}
            onPress={() => void syncNow()}
            loading={syncing}
            size="sm"
            style={styles.syncBtn}
            testID="sync-now"
          />
        ) : null}
      </View>
    </SettingsScreen>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 16, padding: 14 },
  text: { flex: 1, minWidth: 0 },
  label: { fontSize: 15, fontWeight: "600" },
  value: { fontSize: 12.5, marginTop: 1 },
  syncBtn: { minWidth: 92 },
});
