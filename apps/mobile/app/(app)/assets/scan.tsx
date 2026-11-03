import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/lib/theme/useTheme";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { resolveAssetCode, type LookupOutcome } from "@/lib/engineering/assetLookup";
import { findCachedAsset } from "@/lib/engineering/useAssetBrowse";
import { findDurableAsset, forgetAsset, rememberAssets } from "@/lib/engineering/assetCacheStore";
import { formatClock } from "@/lib/housekeeping/myRoomsText";
import { useTextContext } from "@/components/housekeeping/useTextContext";
import { useAppStore } from "@/stores/appStore";

/** The same code seen again inside this window is the camera re-reading one frame, not a second scan. */
const REPEAT_WINDOW_MS = 2500;
const BARCODE_TYPES = ["qr", "code128", "code39", "ean13", "ean8", "upc_a"] as const;

export default function ScanEquipmentScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const user = useAppStore((s) => s.user);
  const isOnline = useAppStore((s) => s.isOnline);
  const scope = user?.id && user?.tenant_id ? `${user.tenant_id}:${user.id}` : null;
  const [permission, requestPermission] = useCameraPermissions();
  const textContext = useTextContext();

  // Hidden tab screens stay mounted, so the camera is only live while this screen is the focused one.
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => {
        setFocused(false);
        busy.current = false;
        lastSeen.current = null;
      };
    }, []),
  );

  const [manual, setManual] = useState(false);
  const [text, setText] = useState("");
  const [resolving, setResolving] = useState(false);
  const [outcome, setOutcome] = useState<LookupOutcome | null>(null);
  const busy = useRef(false);
  const lastSeen = useRef<{ data: string; at: number } | null>(null);

  const resolve = useCallback(
    async (raw: string) => {
      if (busy.current) return;
      busy.current = true;
      setResolving(true);
      try {
        const result = await resolveAssetCode(raw, {
          isOnline,
          // This session's loaded pages first, then the small durable copy of equipment this person opened before.
          findCached: async (code) => {
            const live = findCachedAsset(scope, code);
            if (live) return live;
            const saved = await findDurableAsset(code);
            return saved ? { id: saved.id, name: saved.name, asset_tag: saved.asset_tag, is_active: saved.is_active, verifiedAt: saved.verifiedAt, location: saved.location } : null;
          },
          remember: (asset) => void rememberAssets([asset]),
          forget: (code) => void forgetAsset(code),
        });
        // A saved copy is shown as exactly that - with when it was last confirmed - instead of being opened as if it were live.
        if (result.kind === "found" && !result.fromCache) {
          // Replace, so Back from the asset returns to the list rather than to a live camera.
          router.replace({ pathname: "/(app)/assets/[assetId]", params: { assetId: result.asset.id } } as never);
          return;
        }
        setOutcome(result);
      } finally {
        setResolving(false);
        busy.current = false;
      }
    },
    [isOnline, scope],
  );

  const onScanned = useCallback(
    ({ data }: { data: string }) => {
      const now = Date.now();
      const previous = lastSeen.current;
      if (busy.current || outcome || (previous && previous.data === data && now - previous.at < REPEAT_WINDOW_MS)) return;
      lastSeen.current = { data, at: now };
      void resolve(data);
    },
    [outcome, resolve],
  );

  const rescan = useCallback(() => {
    lastSeen.current = null;
    setOutcome(null);
  }, []);

  const message = outcome && outcome.kind !== "found" ? t(`assets.scan.outcome.${outcome.kind}`) : null;
  const savedCopy = outcome?.kind === "found" ? outcome : null;
  const verifiedClock = savedCopy?.verifiedAt ? formatClock(savedCopy.verifiedAt, textContext) : null;

  const denied = permission && !permission.granted;
  const showCamera = !!permission?.granted && focused && !manual && !outcome;

  return (
    <View style={[styles.container, { backgroundColor: theme.shell.bg, paddingTop: insets.top }]} testID="asset-scan-screen">
      <View style={styles.topBar}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/(app)/assets"))} accessibilityRole="button" accessibilityLabel={t("common.back")} hitSlop={10} style={styles.back} testID="asset-scan-back">
          <Ionicons name="chevron-back" size={24} color={theme.shell.ink} />
        </Pressable>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: theme.shell.ink }]}>
          {t("assets.scan.title")}
        </Text>
      </View>

      {showCamera ? (
        <View style={styles.cameraWrap}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
            onBarcodeScanned={onScanned}
            accessibilityLabel={t("assets.scan.cameraLabel")}
          />
          <View style={styles.frameWrap} pointerEvents="none">
            <View style={[styles.frame, { borderColor: theme.shell.ink }]} />
          </View>
          {resolving ? (
            <View style={styles.resolving}>
              <ActivityIndicator color="#fff" />
              <Text style={styles.resolvingText}>{t("assets.scan.looking")}</Text>
            </View>
          ) : null}
        </View>
      ) : (
        <View style={styles.panel}>
          {!permission ? (
            <ActivityIndicator color={theme.shell.ink} accessibilityLabel={t("common.loading")} />
          ) : denied && !manual && !outcome ? (
            <View style={styles.block} testID="asset-scan-denied">
              <Ionicons name="camera-outline" size={36} color={theme.shell.ink2} />
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.blockTitle, { color: theme.shell.ink }]}>
                {t("assets.scan.permissionTitle")}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.blockBody, { color: theme.shell.ink2 }]}>
                {permission.canAskAgain ? t("assets.scan.permissionBody") : t("assets.scan.permissionBlocked")}
              </Text>
              {permission.canAskAgain ? (
                <Button label={t("assets.scan.allowCamera")} onPress={() => void requestPermission()} testID="asset-scan-allow" />
              ) : (
                <Button label={t("assets.scan.openSettings")} onPress={() => void Linking.openSettings()} testID="asset-scan-settings" />
              )}
            </View>
          ) : null}

          {manual && !message ? (
            <View style={styles.block} testID="asset-scan-manual-hint">
              <Ionicons name="keypad-outline" size={36} color={theme.shell.ink2} />
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.blockBody, { color: theme.shell.ink2 }]}>
                {t("assets.scan.manualHint")}
              </Text>
            </View>
          ) : null}

          {savedCopy ? (
            <View style={styles.block} accessibilityLiveRegion="polite" testID="asset-scan-cached">
              <Ionicons name="cloud-offline-outline" size={36} color={theme.status.pickup} />
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.blockTitle, { color: theme.shell.ink }]}>
                {savedCopy.asset.name}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.blockBody, { color: theme.shell.ink2 }]}>
                {[savedCopy.asset.asset_tag, savedCopy.location].filter(Boolean).join(" \u00b7 ")}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.blockBody, { color: theme.status.pickup }]} testID="asset-scan-cached-note">
                {verifiedClock ? t("assets.scan.cached.verified", { time: verifiedClock }) : t("assets.scan.cached.unverified")}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.blockBody, { color: theme.shell.ink2 }]}>
                {t("assets.scan.cached.body")}
              </Text>
              <Button label={t("assets.scan.cached.open")} onPress={() => router.replace({ pathname: "/(app)/assets/[assetId]", params: { assetId: savedCopy.asset.id } } as never)} testID="asset-scan-cached-open" />
              {permission?.granted ? <Button label={t("assets.scan.scanAgain")} variant="secondary" onPress={rescan} testID="asset-scan-again" /> : null}
            </View>
          ) : null}

          {message ? (
            <View style={styles.block} accessibilityLiveRegion="polite" testID="asset-scan-outcome">
              <Ionicons name="alert-circle-outline" size={36} color={theme.status.pickup} />
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.blockTitle, { color: theme.shell.ink }]}>
                {message}
              </Text>
              {outcome?.kind === "invalid" ? (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.blockBody, { color: theme.shell.ink2 }]}>
                  {t("assets.scan.invalidHint")}
                </Text>
              ) : null}
              {outcome?.kind === "retired" ? (
                <Button
                  label={t("assets.scan.openRetired")}
                  onPress={() => router.replace({ pathname: "/(app)/assets/[assetId]", params: { assetId: outcome.asset.id } } as never)}
                  testID="asset-scan-open-retired"
                />
              ) : null}
              {permission?.granted ? <Button label={t("assets.scan.scanAgain")} variant={outcome?.kind === "retired" ? "secondary" : "primary"} onPress={rescan} testID="asset-scan-again" /> : null}
            </View>
          ) : null}
        </View>
      )}

      <View style={[styles.footer, { paddingBottom: insets.bottom + 14 }]}>
        {!manual && !outcome && permission?.granted ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.shell.ink2 }]}>
            {t("assets.scan.instruction")}
          </Text>
        ) : null}

        {manual ? (
          <View style={styles.manual} testID="asset-scan-manual">
            <TextInput
              value={text}
              onChangeText={(value) => {
                setText(value);
                if (outcome) setOutcome(null);
              }}
              placeholder={t("assets.scan.manualPlaceholder")}
              placeholderTextColor={theme.shell.ink3}
              style={[styles.input, { color: theme.shell.ink, backgroundColor: theme.shell.surface, borderColor: theme.shell.line }]}
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="search"
              onSubmitEditing={() => void resolve(text)}
              maxLength={64}
              accessibilityLabel={t("assets.scan.manualPlaceholder")}
              testID="asset-scan-input"
            />
            <Button label={t("assets.scan.find")} onPress={() => void resolve(text)} loading={resolving} disabled={!text.trim()} testID="asset-scan-find" />
            {permission?.granted ? (
              <Button label={t("assets.scan.useCamera")} variant="ghost" onPress={() => { setManual(false); setOutcome(null); }} testID="asset-scan-use-camera" />
            ) : null}
          </View>
        ) : (
          <Button label={t("assets.scan.enterManually")} variant="secondary" onPress={() => { setManual(true); setOutcome(null); }} testID="asset-scan-manual-open" />
        )}
        <Button label={t("assets.scan.searchList")} variant="ghost" onPress={() => router.replace("/(app)/assets")} testID="asset-scan-search-list" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, minHeight: 52 },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 20, fontWeight: "600" },
  cameraWrap: { flex: 1, marginHorizontal: 16, borderRadius: 22, overflow: "hidden", backgroundColor: "#000" },
  frameWrap: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  frame: { width: "68%", aspectRatio: 1, borderWidth: 3, borderRadius: 24 },
  resolving: { position: "absolute", bottom: 18, alignSelf: "center", flexDirection: "row", gap: 8, alignItems: "center", backgroundColor: "rgba(0,0,0,0.65)", paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999 },
  resolvingText: { color: "#fff", fontSize: 13.5, fontWeight: "600" },
  panel: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24, gap: 16 },
  block: { alignItems: "center", gap: 12, alignSelf: "stretch" },
  blockTitle: { fontSize: 17, fontWeight: "700", textAlign: "center" },
  blockBody: { fontSize: 14, textAlign: "center", lineHeight: 20 },
  footer: { paddingHorizontal: 16, paddingTop: 12, gap: 8 },
  hint: { textAlign: "center", fontSize: 14 },
  manual: { gap: 8 },
  input: { minHeight: 52, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, fontSize: 16 },
});
