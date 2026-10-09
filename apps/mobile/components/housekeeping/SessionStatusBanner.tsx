import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { getPhase, hasPendingSync, pendingChangeCount, type LocalCleanSession } from "@/lib/housekeeping/cleanSession";

interface Props {
  session: LocalCleanSession;
  onRetry: () => void;
  onDiscard: () => void;
  /** Connectivity, so offline work reads as "last known", not as confirmed. */
  isOnline?: boolean;
}

/**
 * Makes the sync state of a clean session explicit: what is only on this device,
 * what the server refused, and what the housekeeper can do about it. A queued
 * completion is never presented as done.
 */
export default function SessionStatusBanner({ session, onRetry, onDiscard, isOnline = true }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const phase = getPhase(session);

  if (phase === "conflict" && session.conflict) {
    const conflict = session.conflict;
    return (
      <View
        style={[styles.card, { backgroundColor: theme.status.dirtySoft, borderColor: theme.status.dirtyLine }]}
        accessibilityRole="alert"
        testID="session-conflict-banner"
      >
        <View style={styles.row}>
          <Ionicons name="warning" size={16} color={theme.status.dirty} />
          <Text style={[styles.title, { color: theme.status.dirty }]}>{t("rooms.detail.session.conflictTitle")}</Text>
        </View>
        <Text style={[styles.body, { color: theme.textPrimary }]}>
          {t(`rooms.detail.session.errors.${conflict.code}`, { defaultValue: conflict.message })}
        </Text>
        <Text style={[styles.body, { color: theme.textSecondary }]}>{t("rooms.detail.session.conflictKept")}</Text>
        <View style={styles.actions}>
          <TouchableOpacity
            onPress={onRetry}
            style={[styles.btn, { borderColor: theme.primaryLine, backgroundColor: theme.primarySoft }]}
            accessibilityRole="button"
            accessibilityLabel={t("rooms.detail.session.retry")}
          >
            <Text style={[styles.btnText, { color: theme.primaryAction }]}>{t("rooms.detail.session.retry")}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() =>
              Alert.alert(t("rooms.detail.session.discardTitle"), t("rooms.detail.session.discardBody"), [
                { text: t("rooms.detailActions.cancel"), style: "cancel" },
                { text: t("rooms.detail.session.discard"), style: "destructive", onPress: onDiscard },
              ])
            }
            style={[styles.btn, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}
            accessibilityRole="button"
            accessibilityLabel={t("rooms.detail.session.discard")}
          >
            <Text style={[styles.btnText, { color: theme.textSecondary }]}>{t("rooms.detail.session.discard")}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (phase === "completing") {
    return (
      <View
        style={[styles.card, { backgroundColor: theme.status.pickupSoft, borderColor: theme.status.pickupLine }]}
        testID="session-completing-banner"
      >
        <View style={styles.row}>
          <Ionicons name="cloud-upload-outline" size={16} color={theme.status.pickup} />
          <Text style={[styles.title, { color: theme.status.pickup }]}>{t("rooms.detail.session.completingTitle")}</Text>
        </View>
        <Text style={[styles.body, { color: theme.textSecondary }]}>
          {t(session.completionUnsure ? "rooms.detail.session.completingUnsure" : "rooms.detail.session.completingBody")}
        </Text>
      </View>
    );
  }

  if (session.lastError) {
    const missing = session.lastError.missing ?? [];
    return (
      <View
        style={[styles.card, { backgroundColor: theme.status.pickupSoft, borderColor: theme.status.pickupLine }]}
        accessibilityRole="alert"
        testID="session-required-banner"
      >
        <View style={styles.row}>
          <Ionicons name="alert-circle-outline" size={16} color={theme.status.pickup} />
          <Text style={[styles.title, { color: theme.status.pickup }]}>{t("rooms.detail.session.requiredBlockedTitle")}</Text>
        </View>
        <Text style={[styles.body, { color: theme.textSecondary }]}>
          {missing.length > 0 ? missing.join(" · ") : session.lastError.message}
        </Text>
      </View>
    );
  }

  if (!isOnline && !session.completionConfirmed) {
    const count = pendingChangeCount(session);
    return (
      <View
        style={[styles.card, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}
        testID="session-offline-banner"
        accessibilityRole="alert"
      >
        <View style={styles.row}>
          <Ionicons name="cloud-offline-outline" size={16} color={theme.textMuted} />
          <Text style={[styles.title, { color: theme.textSecondary }]}>{t("rooms.work.offline.title")}</Text>
        </View>
        <Text style={[styles.body, { color: theme.textSecondary }]}>
          {count > 0 ? t("rooms.work.offline.pending", { count }) : t("rooms.work.offline.body")}
        </Text>
      </View>
    );
  }

  if (hasPendingSync(session)) {
    return (
      <View
        style={[styles.card, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}
        testID="session-pending-banner"
      >
        <View style={styles.row}>
          <Ionicons name="sync-outline" size={16} color={theme.textMuted} />
          <Text style={[styles.title, { color: theme.textSecondary }]}>
            {t(session.startConfirmed ? "rooms.detail.session.changesPending" : "rooms.detail.session.startPending")}
          </Text>
        </View>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 13, fontWeight: "800", flex: 1 },
  body: { fontSize: 13, lineHeight: 18 },
  actions: { flexDirection: "row", gap: 10, marginTop: 4 },
  btn: { minHeight: 44, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  btnText: { fontSize: 13, fontWeight: "800" },
});
