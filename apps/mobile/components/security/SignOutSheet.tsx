import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { UnsyncedChangesSheet, UnsyncedList } from "@/components/security/UnsyncedChangesSheet";
import { totalPending, useUnsyncedSummary } from "@/lib/auth/pendingWork";
import { signOutThisDevice } from "@/lib/auth/signOut";
import { useTheme } from "@/lib/theme/useTheme";
import { useAppStore } from "@/stores/appStore";
import { SETTINGS_MAX_FONT_SCALE as MAX_FONT_SCALE } from "@/lib/settings/a11y";


/**
 * "Sign out" confirmation for THIS device. States plainly what happens, and when work is still saved
 * on the phone, lists it by kind and says it stays saved under this account and only sends after they
 * sign in here again. Nothing is deleted.
 */
export function SignOutSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const rows = useUnsyncedSummary();
  const isOnline = useAppStore((s) => s.isOnline);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const total = totalPending(rows);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const failure = await signOutThisDevice();
      if (failure) {
        setFailed(true);
        return;
      }
      onClose();
      router.replace("/(auth)/login");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <BottomSheet
        visible={visible && !detailsOpen}
        title={t("security.signOut.title")}
        onClose={busy ? () => undefined : onClose}
        testID="signout-sheet"
        footer={
          <View style={styles.actions}>
            <Button
              label={total > 0 ? t("profile.signOutAnyway") : t("profile.signOut")}
              variant="destructive"
              onPress={() => void confirm()}
              loading={busy}
              testID="signout-confirm"
            />
            <Button label={t("common.cancel")} variant="secondary" onPress={onClose} disabled={busy} testID="signout-cancel" />
          </View>
        }
      >
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
          {t("security.signOut.body")}
        </Text>
        {total > 0 ? (
          <View style={styles.warning} testID="signout-unsynced">
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="alert" style={[styles.warnTitle, { color: theme.textPrimary }]}>
              {t("security.signOut.unsyncedTitle", { count: total })}
            </Text>
            <UnsyncedList rows={rows} />
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
              {t("security.signOut.unsyncedBody")}
              {!isOnline ? ` ${t("security.signOut.offlineNote")}` : ""}
            </Text>
            <Button label={t("security.signOut.viewDetails")} variant="ghost" size="md" onPress={() => setDetailsOpen(true)} testID="signout-details" />
          </View>
        ) : null}
        {failed ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="alert" style={[styles.error, { color: theme.status.dirty }]} testID="signout-error">
            {t("security.signOut.failed")}
          </Text>
        ) : null}
      </BottomSheet>
      <UnsyncedChangesSheet visible={visible && detailsOpen} onClose={() => setDetailsOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  actions: { gap: 8 },
  body: { fontSize: 14, lineHeight: 20 },
  warning: { gap: 10 },
  warnTitle: { fontSize: 15, fontWeight: "700" },
  error: { fontSize: 13.5, lineHeight: 19, fontWeight: "600" },
});
