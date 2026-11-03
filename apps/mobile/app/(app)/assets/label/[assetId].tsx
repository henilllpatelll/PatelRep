import { useCallback, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { QrCode } from "@/components/engineering/assets/QrCode";
import { Button } from "@/components/ui/Button";
import { StateBlock } from "@/components/ui/StateBlock";
import { Note } from "@/components/engineering/workorder/sheetKit";
import { useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";
import { getAsset } from "@/lib/api/assets";
import { labelCode, labelPayload, type LabelContent } from "@/lib/engineering/assetLabel";
import { printLabel, shareLabel } from "@/lib/engineering/assetLabelActions";
import { ASSETS_LIST_ROUTE, assetRoute } from "@/lib/engineering/routes";
import { useAsyncResource } from "@/lib/engineering/useAsyncResource";
import { useSettingsIdentity } from "@/lib/settings/useSettingsIdentity";
import { useAppStore } from "@/stores/appStore";

/** Engineering -> Assets -> Asset Detail -> More -> QR Label: the equipment's scannable label, to share or print. */
export default function AssetLabelScreen() {
  const { assetId } = useLocalSearchParams<{ assetId: string }>();
  const { t } = useTranslation();
  const theme = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const user = useAppStore((s) => s.user);
  const { hotelName } = useSettingsIdentity();
  const scope = user?.id && user?.tenant_id ? `${user.tenant_id}:${user.id}` : null;
  const id = typeof assetId === "string" ? assetId : "";
  const asset = useAsyncResource((signal) => getAsset(id, signal), { scope, key: `asset:${id}`, enabled: !!id });
  const [busy, setBusy] = useState<"print" | "share" | null>(null);
  const working = useRef(false);

  // Hidden tab screens stay mounted: a name or tag edited elsewhere must reach the label before it is printed.
  const first = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      void asset.reload();
    }, [id]),
  );

  const back = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace((assetRoute(id) ?? ASSETS_LIST_ROUTE) as never);
  }, [id]);

  const data = asset.data;
  const location = data ? (data.rooms?.room_number ? [t("assets.roomLabel", { room: data.rooms.room_number }), data.location_text?.trim()].filter(Boolean).join(" · ") : data.location_text?.trim() || null) : null;
  const content: LabelContent | null = data
    ? { assetId: data.id, name: data.name, assetTag: data.asset_tag?.trim() || null, location, property: hotelName }
    : null;

  const hand = async (kind: "print" | "share") => {
    if (!content || working.current) return;
    working.current = true;
    setBusy(kind);
    try {
      const result = kind === "print" ? await printLabel(content) : await shareLabel(content, t("assets.label.shareTitle", { name: content.name }));
      if (result === "unavailable") toast.error(t("assets.label.shareUnavailable"));
    } catch {
      toast.error(t(kind === "print" ? "assets.label.printFailed" : "assets.label.shareFailed"));
    } finally {
      working.current = false;
      setBusy(null);
    }
  };

  const header = (
    <View style={[styles.hero, { paddingTop: insets.top + 8, backgroundColor: theme.shell.bg }]}>
      <Pressable onPress={back} accessibilityRole="button" accessibilityLabel={t("common.back")} hitSlop={8} style={styles.back} testID="asset-label-back">
        <Ionicons name="chevron-back" size={24} color={theme.shell.ink} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.shell.ink, fontSize: 15 }}>
          {t("common.back")}
        </Text>
      </Pressable>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.heroTitle, { color: theme.shell.ink }]}>
        {t("assets.label.title")}
      </Text>
    </View>
  );

  if (!id || asset.status === 404) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]} testID="asset-label-unavailable">
        {header}
        <StateBlock status="empty" emptyIcon="cube-outline" emptyTitle={t("assets.detail.unavailableTitle")} emptyBody={t("assets.detail.unavailableBody")} />
      </View>
    );
  }
  if (!data || !content) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]} testID="asset-label-state">
        {header}
        {asset.failure ? (
          <StateBlock status="error" errorMessage={t(asset.failure === "forbidden" ? "engineeringState.forbidden" : "engineeringState.loadFailed")} onRetry={() => void asset.reload()} retryLabel={t("common.retry")} />
        ) : (
          <StateBlock status="loading" />
        )}
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]} testID="asset-label">
      {header}
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
        {/* The label is always black on white, whatever the app theme: it is a picture of a physical sticker. */}
        <View style={styles.card} testID="asset-label-card">
          {hotelName ? <Text style={styles.property}>{hotelName}</Text> : null}
          <QrCode payload={labelPayload(data.id)} size={232} label={t("assets.label.qrLabel", { name: data.name })} testID="asset-label-qr" />
          <Text style={styles.name} testID="asset-label-name">
            {data.name}
          </Text>
          <Text style={styles.code} testID="asset-label-code">
            {labelCode({ assetId: data.id, assetTag: content.assetTag })}
          </Text>
          {location ? <Text style={styles.location}>{location}</Text> : null}
        </View>

        {data.is_active === false ? <Note tone="warn">{t("assets.label.retiredNote")}</Note> : null}
        {!content.assetTag ? <Note>{t("assets.label.noTagNote")}</Note> : null}

        <Button label={t("assets.label.share")} icon="share-outline" onPress={() => void hand("share")} loading={busy === "share"} disabled={busy != null} size="lg" testID="asset-label-share" />
        <Button label={t("assets.label.print")} icon="print-outline" variant="secondary" onPress={() => void hand("print")} loading={busy === "print"} disabled={busy != null} testID="asset-label-print" />
        <Note>{t("assets.label.handoffNote")}</Note>
        <Button label={t("assets.label.backToEquipment")} variant="ghost" onPress={back} testID="asset-label-done" />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  hero: { paddingHorizontal: 18, paddingBottom: 18, borderBottomLeftRadius: 26, borderBottomRightRadius: 26, gap: 6 },
  back: { flexDirection: "row", alignItems: "center", minHeight: 44, marginLeft: -4 },
  heroTitle: { fontSize: 25, lineHeight: 30, fontWeight: "600" },
  content: { paddingHorizontal: 18, paddingTop: 16, gap: 12 },
  card: { backgroundColor: "#FFFFFF", borderRadius: 16, borderWidth: 1, borderColor: "#D9D9D9", padding: 18, alignItems: "center", gap: 8 },
  property: { color: "#333333", fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase" },
  name: { color: "#000000", fontSize: 18, fontWeight: "700", textAlign: "center" },
  code: { color: "#000000", fontSize: 24, fontWeight: "800", fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }), textAlign: "center" },
  location: { color: "#222222", fontSize: 14, textAlign: "center" },
});
