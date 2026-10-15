import { useCallback, useEffect, useState } from "react";
import { Platform, StyleSheet, Text } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsScreen } from "@/components/settings/SettingsScreen";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { LockTimeoutSheet, timeoutLabelKey } from "@/components/security/LockTimeoutSheet";
import { SimpleConfirmSheet } from "@/components/security/SimpleConfirmSheet";
import { signOutOtherDevices } from "@/lib/auth/signOut";
import { authenticate, getBiometricCapability, type BiometricCapability } from "@/lib/security/biometrics";
import type { LockTimeoutMs } from "@/lib/security/appLockPrefs";
import { useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";
import { useAppStore } from "@/stores/appStore";
import { runWithoutAppLock, useAppLockStore } from "@/stores/appLockStore";
import { SETTINGS_MAX_FONT_SCALE as MAX_FONT_SCALE } from "@/lib/settings/a11y";

/** Biometric name as the platform calls it. */
function biometricName(cap: BiometricCapability | null, t: (k: string) => string): string {
  if (cap?.available) {
    if (cap.kind === "face") return Platform.OS === "ios" ? t("security.biometric.faceId") : t("security.biometric.face");
    if (cap.kind === "fingerprint") return Platform.OS === "ios" ? t("security.biometric.touchId") : t("security.biometric.fingerprint");
  }
  return t("security.biometric.generic");
}

export default function SecuritySettingsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const toast = useToast();
  const isOnline = useAppStore((s) => s.isOnline);
  const lockEnabled = useAppLockStore((s) => s.enabled);
  const timeoutMs = useAppLockStore((s) => s.timeoutMs);
  const [capability, setCapability] = useState<BiometricCapability | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [timeoutOpen, setTimeoutOpen] = useState(false);
  const [othersOpen, setOthersOpen] = useState(false);
  const [othersBusy, setOthersBusy] = useState(false);
  const [othersError, setOthersError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void getBiometricCapability().then((cap) => {
      if (mounted) setCapability(cap);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const name = biometricName(capability, t);
  const unavailable = capability !== null && !capability.available;
  const biometricSubtitle = lockEnabled
    ? t("security.biometric.on")
    : capability === null
      ? t("security.biometric.checking")
      : capability.available
        ? t("security.biometric.off", { name })
        : t(capability.reason === "notEnrolled" ? "security.biometric.notEnrolled" : "security.biometric.unsupported");

  const startToggle = useCallback(
    async (next: boolean) => {
      if (next) {
        setSetupError(null);
        setSetupOpen(true);
        return;
      }
      // Turning protection off needs the same proof as turning it on, unless the phone can no longer ask.
      const stillAvailable = (await getBiometricCapability()).available;
      if (stillAvailable) {
        const outcome = await runWithoutAppLock(() => authenticate(t("security.biometric.disablePrompt"), t("common.cancel")));
        if (outcome !== "success") {
          if (outcome !== "cancelled") toast.error(t("security.biometric.authFailed"));
          return;
        }
      }
      try {
        await useAppLockStore.getState().setEnabled(false);
        toast.success(t("security.biometric.disabled"));
      } catch {
        toast.error(t("security.errors.saveFailed"));
      }
    },
    [t, toast],
  );

  async function confirmEnable() {
    if (setupBusy) return;
    setSetupBusy(true);
    setSetupError(null);
    try {
      const cap = await getBiometricCapability();
      if (!cap.available) {
        setCapability(cap);
        setSetupError(t(cap.reason === "notEnrolled" ? "security.biometric.notEnrolled" : "security.biometric.unsupported"));
        return;
      }
      const outcome = await runWithoutAppLock(() => authenticate(t("security.biometric.enablePrompt"), t("common.cancel")));
      if (outcome !== "success") {
        setSetupError(t(outcome === "cancelled" ? "security.biometric.cancelled" : "security.biometric.authFailed"));
        return;
      }
      // Shown as enabled only now: the OS challenge succeeded and the choice was saved.
      await useAppLockStore.getState().setEnabled(true);
      setSetupOpen(false);
      toast.success(t("security.biometric.enabled"));
    } catch {
      setSetupError(t("security.errors.saveFailed"));
    } finally {
      setSetupBusy(false);
    }
  }

  async function selectTimeout(ms: LockTimeoutMs) {
    try {
      await useAppLockStore.getState().setTimeoutMs(ms);
      setTimeoutOpen(false);
    } catch {
      toast.error(t("security.errors.saveFailed"));
    }
  }

  async function confirmSignOutOthers() {
    if (othersBusy) return;
    setOthersBusy(true);
    setOthersError(null);
    try {
      const failure = await signOutOtherDevices();
      if (failure) {
        setOthersError(t(`security.others.errors.${failure === "offline" || failure === "session" ? failure : "generic"}`));
        return;
      }
      setOthersOpen(false);
      toast.success(t("security.others.done"));
    } finally {
      setOthersBusy(false);
    }
  }

  return (
    <SettingsScreen title={t("settings.security.title")} back>
      <SettingsSection title={t("security.sections.password")}>
        <SettingsRow
          first
          icon="key-outline"
          label={t("security.password.title")}
          subtitle={t("security.password.subtitle")}
          onPress={() => router.push("/(app)/profile/change-password")}
          testID="row-change-password"
        />
      </SettingsSection>

      <SettingsSection title={t("security.sections.protection")}>
        <SettingsRow
          first
          icon="finger-print-outline"
          label={t("security.biometric.title")}
          subtitle={biometricSubtitle}
          switchValue={lockEnabled}
          onSwitchChange={(next) => void startToggle(next)}
          disabled={capability === null || (unavailable && !lockEnabled)}
          testID="row-biometric"
        />
        <SettingsRow
          icon="timer-outline"
          label={t("security.lockAfter.title")}
          subtitle={lockEnabled ? t(timeoutLabelKey(timeoutMs)) : t("security.lockAfter.needsLock")}
          onPress={() => setTimeoutOpen(true)}
          disabled={!lockEnabled}
          testID="row-lock-after"
        />
      </SettingsSection>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textMuted }]}>
        {t("security.biometric.note")}
      </Text>

      <SettingsSection title={t("security.sections.devices")}>
        <SettingsRow
          first
          icon="phone-portrait-outline"
          label={t("security.devices.title")}
          subtitle={t("security.devices.subtitle")}
          onPress={() => router.push("/(app)/profile/devices")}
          testID="row-devices"
        />
      </SettingsSection>

      <SettingsSection title={t("security.sections.actions")}>
        <SettingsRow
          first
          icon="log-out-outline"
          label={t("security.others.title")}
          subtitle={isOnline ? t("security.others.subtitle") : t("security.others.offline")}
          onPress={() => {
            setOthersError(null);
            setOthersOpen(true);
          }}
          disabled={!isOnline}
          testID="row-signout-others"
        />
      </SettingsSection>

      <SimpleConfirmSheet
        visible={setupOpen}
        title={t("security.biometric.setupTitle", { name })}
        body={t("security.biometric.setupBody", { name })}
        error={setupError}
        confirmLabel={t("security.biometric.enable")}
        cancelLabel={t("common.cancel")}
        busy={setupBusy}
        onConfirm={() => void confirmEnable()}
        onClose={() => setSetupOpen(false)}
        testID="biometric-setup"
      />
      <LockTimeoutSheet visible={timeoutOpen} value={timeoutMs} onSelect={(ms) => void selectTimeout(ms)} onClose={() => setTimeoutOpen(false)} />
      <SimpleConfirmSheet
        visible={othersOpen}
        title={t("security.others.confirmTitle")}
        body={t("security.others.confirmBody")}
        error={othersError}
        confirmLabel={t("security.others.confirm")}
        cancelLabel={t("common.cancel")}
        destructive
        busy={othersBusy}
        onConfirm={() => void confirmSignOutOthers()}
        onClose={() => setOthersOpen(false)}
        testID="signout-others"
      />
    </SettingsScreen>
  );
}

const styles = StyleSheet.create({
  note: { fontSize: 12.5, lineHeight: 18, paddingHorizontal: 4, marginTop: -8 },
});
