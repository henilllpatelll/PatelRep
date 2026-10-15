import { useMemo, useRef, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { monoFont } from "@/components/shared/tokens";
import { SettingsDetailRow } from "@/components/settings/SettingsDetailRow";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsScreen } from "@/components/settings/SettingsScreen";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { getAppInfo, shortUpdateId } from "@/lib/app/appInfo";
import { openExternalUrl, readLegalLinks, type OpenLinkResult } from "@/lib/app/externalLinks";
import { findReleaseNotes } from "@/lib/app/releaseNotes";
import { useTheme } from "@/lib/theme/useTheme";
import { useAppStore } from "@/stores/appStore";
import { SETTINGS_MAX_FONT_SCALE as MAX_FONT_SCALE } from "@/lib/settings/a11y";

const appIcon = require("../../../assets/icon.png");

type LinkKey = "privacy" | "terms";

export default function AboutScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const online = useAppStore((s) => s.isOnline);
  const info = useMemo(() => getAppInfo(), []);
  const legal = useMemo(() => readLegalLinks(), []);
  const hasNotes = findReleaseNotes(info.version) !== null;
  const [linkFailure, setLinkFailure] = useState<{ key: LinkKey; result: OpenLinkResult } | null>(null);
  const [opening, setOpening] = useState<LinkKey | null>(null);
  // A ref, not state: two quick taps can land before the screen re-renders.
  const openingRef = useRef(false);

  const links: { key: LinkKey; url: string | null; icon: "shield-checkmark-outline" | "document-text-outline"; label: string }[] = [
    { key: "privacy", url: legal.privacyPolicyUrl, icon: "shield-checkmark-outline", label: t("about.privacy") },
    { key: "terms", url: legal.termsOfServiceUrl, icon: "document-text-outline", label: t("about.terms") },
  ];

  async function openLink(key: LinkKey, url: string | null) {
    if (openingRef.current) return;
    openingRef.current = true;
    setOpening(key);
    setLinkFailure(null);
    try {
      const result = await openExternalUrl(url, online);
      if (result !== "opened") setLinkFailure({ key, result });
    } finally {
      openingRef.current = false;
      setOpening(null);
    }
  }

  const failedLink = linkFailure ? links.find((l) => l.key === linkFailure.key) : null;
  const unavailable = t("about.unavailable");
  const versionText = info.version ?? unavailable;

  return (
    <SettingsScreen title={t("settings.about.title")} back>
      <View style={styles.identity} accessible accessibilityLabel={`${info.name}. ${t("about.tagline")}. ${t("about.version")} ${versionText}`} testID="about-identity">
        <Image source={appIcon} style={[styles.icon, { borderColor: theme.border }]} accessibilityIgnoresInvertColors />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.name, { color: theme.textPrimary }]} testID="about-name">
          {info.name}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.tagline, { color: theme.textSecondary }]}>
          {t("about.tagline")}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.versionLine, { color: theme.textMuted }]} testID="about-version-line">
          {info.version ? t("about.versionLine", { version: info.version }) : unavailable}
        </Text>
      </View>

      <SettingsSection title={t("about.sections.application")}>
        <SettingsDetailRow first label={t("about.version")} value={versionText} testID="about-version" />
        {info.build ? <SettingsDetailRow label={t("about.build")} value={info.build} testID="about-build" /> : null}
        {info.updateId ? <SettingsDetailRow label={t("about.updateId")} value={shortUpdateId(info.updateId)} testID="about-update-id" /> : null}
      </SettingsSection>

      {hasNotes ? (
        <SettingsSection title={t("about.sections.product")}>
          <SettingsRow
            first
            icon="sparkles-outline"
            label={t("about.whatsNew.title")}
            subtitle={t("about.whatsNew.rowSubtitle", { version: versionText })}
            onPress={() => router.push("/(app)/profile/whats-new" as never)}
            testID="row-whats-new"
          />
        </SettingsSection>
      ) : null}

      <SettingsSection title={t("about.sections.support")}>
        <SettingsRow
          first
          icon="help-buoy-outline"
          label={t("about.contactSupport")}
          subtitle={t("settings.help.subtitle")}
          onPress={() => router.push("/(app)/profile/help" as never)}
          testID="row-contact-support"
        />
      </SettingsSection>

      <SettingsSection title={t("about.sections.legal")}>
        {links
          .filter((l) => l.url)
          .map((l, index) => (
            <SettingsRow
              key={l.key}
              first={index === 0}
              icon={l.icon}
              label={l.label}
              subtitle={t("about.opensInBrowser")}
              disabled={opening !== null}
              accessibilityHint={t("about.opensInBrowserHint")}
              onPress={() => void openLink(l.key, l.url)}
              testID={`row-${l.key}`}
            />
          ))}
        <SettingsRow
          first={!links.some((l) => l.url)}
          icon="library-outline"
          label={t("about.licenses.title")}
          subtitle={t("about.licenses.rowSubtitle")}
          onPress={() => router.push("/(app)/profile/licenses" as never)}
          testID="row-licenses"
        />
      </SettingsSection>

      {linkFailure && failedLink ? (
        <View
          style={[styles.notice, { backgroundColor: theme.surfaceMuted, borderColor: theme.borderSubtle }]}
          accessibilityRole="alert"
          testID="about-link-error"
        >
          <Ionicons name={linkFailure.result === "offline" ? "cloud-offline-outline" : "alert-circle-outline"} size={20} color={theme.textMuted} />
          <View style={styles.noticeBody}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.noticeText, { color: theme.textSecondary }]}>
              {linkFailure.result === "offline"
                ? t("about.errors.offline", { page: failedLink.label })
                : t("about.errors.failed", { page: failedLink.label })}
            </Text>
            <Button
              label={t("common.retry")}
              size="md"
              variant="secondary"
              onPress={() => void openLink(failedLink.key, failedLink.url)}
              testID="about-link-retry"
            />
          </View>
        </View>
      ) : null}

      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.footer, { color: theme.textDisabled }]} testID="about-footer">
        {info.name}
      </Text>
    </SettingsScreen>
  );
}

const styles = StyleSheet.create({
  identity: { alignItems: "center", gap: 4, paddingVertical: 8 },
  icon: { width: 72, height: 72, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, marginBottom: 8 },
  name: { fontSize: 22, fontWeight: "700" },
  tagline: { fontSize: 14.5, textAlign: "center" },
  versionLine: { fontFamily: monoFont, fontSize: 12.5, marginTop: 2 },
  notice: { flexDirection: "row", gap: 12, borderWidth: 1, borderRadius: 14, padding: 14, alignItems: "flex-start" },
  noticeBody: { flex: 1, gap: 10, alignItems: "flex-start" },
  noticeText: { fontSize: 14, lineHeight: 20 },
  footer: { textAlign: "center", fontFamily: monoFont, fontSize: 11 },
});
