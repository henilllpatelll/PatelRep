import { useEffect, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import Constants from "expo-constants";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { SettingsScreen } from "@/components/settings/SettingsScreen";
import { SimpleConfirmSheet } from "@/components/security/SimpleConfirmSheet";
import { Button } from "@/components/ui/Button";
import { signOutOtherDevices } from "@/lib/auth/signOut";
import { supabase } from "@/lib/supabase";
import { useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";
import { useAppStore } from "@/stores/appStore";

function formatSignedIn(iso: string | null | undefined, language: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(language === "es" ? "es-US" : "en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/**
 * Supabase Auth does not offer a per-user list of other sessions to the app, so this screen is
 * deliberately limited to what is true: facts about THIS phone's session, plus the one real
 * cross-device capability, revoking every other session. It never invents other devices.
 */
export default function DevicesScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const toast = useToast();
  const isOnline = useAppStore((s) => s.isOnline);
  const [signedInAt, setSignedInAt] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (mounted) setSignedInAt(data.session?.user?.last_sign_in_at ?? null);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);

  const platformName = Platform.OS === "ios" ? "iOS" : Platform.OS === "android" ? "Android" : String(Platform.OS);
  const signedIn = formatSignedIn(signedInAt, i18n?.language ?? "en");
  const version = Constants.expoConfig?.version ?? "dev";
  const deviceLine = `${platformName} ${String(Platform.Version)} · PatelRep v${version}`;

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const failure = await signOutOtherDevices();
      if (failure) {
        setError(t(`security.others.errors.${failure === "offline" || failure === "session" ? failure : "generic"}`));
        return;
      }
      setOpen(false);
      toast.success(t("security.others.done"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsScreen title={t("security.devices.title")} back>
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]} testID="current-device">
        <View style={[styles.icon, { backgroundColor: theme.primarySoft }]}>
          <Ionicons name="phone-portrait-outline" size={22} color={theme.primary} />
        </View>
        <View style={styles.text}>
          <View style={styles.titleRow}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.title, { color: theme.textPrimary }]}>
              {t("security.devices.thisDevice")}
            </Text>
            <View style={[styles.badge, { backgroundColor: theme.primarySoft }]}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.badgeText, { color: theme.primary }]}>
                {t("security.devices.current")}
              </Text>
            </View>
          </View>
          <Text maxFontSizeMultiplier={1.4} style={[styles.meta, { color: theme.textMuted }]} testID="device-platform">
            {deviceLine}
          </Text>
          {signedIn ? (
            <Text maxFontSizeMultiplier={1.4} style={[styles.meta, { color: theme.textMuted }]} testID="device-signed-in">
              {t("security.devices.signedIn", { when: signedIn })}
            </Text>
          ) : null}
        </View>
      </View>

      <Text maxFontSizeMultiplier={1.4} style={[styles.explain, { color: theme.textSecondary }]} testID="devices-note">
        {t("security.devices.note")}
      </Text>

      <Button
        label={t("security.others.title")}
        variant="secondary"
        icon="log-out-outline"
        onPress={() => {
          setError(null);
          setOpen(true);
        }}
        disabled={!isOnline}
        testID="devices-signout-others"
      />
      {!isOnline ? (
        <Text maxFontSizeMultiplier={1.4} style={[styles.explain, { color: theme.textMuted }]}>
          {t("security.others.offline")}
        </Text>
      ) : null}

      <SimpleConfirmSheet
        visible={open}
        title={t("security.others.confirmTitle")}
        body={t("security.others.confirmBody")}
        error={error}
        confirmLabel={t("security.others.confirm")}
        cancelLabel={t("common.cancel")}
        destructive
        busy={busy}
        onConfirm={() => void confirm()}
        onClose={() => setOpen(false)}
        testID="devices-others"
      />
    </SettingsScreen>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", gap: 14, borderWidth: 1, borderRadius: 16, padding: 14, alignItems: "center" },
  icon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  text: { flex: 1, minWidth: 0, gap: 2 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  title: { fontSize: 15.5, fontWeight: "700" },
  badge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 11.5, fontWeight: "700" },
  meta: { fontSize: 12.5, lineHeight: 18 },
  explain: { fontSize: 13.5, lineHeight: 19 },
});
