import type { ComponentProps, ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { useV2Text } from "@/lib/design/housekeeperV2";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import type { AssetServiceStatus } from "@/lib/engineering/assetModel";

type IconName = ComponentProps<typeof Ionicons>["name"];

/** Colour + icon + word per service status: state is never carried by colour alone. */
export function useStatusTone(status: AssetServiceStatus): { fg: string; bg: string; icon: IconName } {
  const theme = useTheme();
  switch (status) {
    case "out_of_service":
      return { fg: theme.status.dirty, bg: theme.status.dirtySoft, icon: "ban-outline" };
    case "degraded":
      return { fg: theme.status.pickup, bg: theme.status.pickupSoft, icon: "alert-circle-outline" };
    case "under_repair":
      return { fg: theme.status.clean, bg: theme.status.cleanSoft, icon: "construct-outline" };
    default:
      return { fg: theme.status.ready, bg: theme.status.readySoft, icon: "checkmark-circle-outline" };
  }
}

export function StatusBadge({ status, testID }: { status: AssetServiceStatus; testID?: string }) {
  const { t } = useTranslation();
  const tone = useStatusTone(status);
  return (
    <View style={[styles.badge, { backgroundColor: tone.bg }]} testID={testID}>
      <Ionicons name={tone.icon} size={13} color={tone.fg} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.badgeText, { color: tone.fg }]}>
        {t(`assets.status.${status}`)}
      </Text>
    </View>
  );
}

/** A small icon + text fact. `tone` colours only the optional emphasis states. */
export function Fact({ icon, text, tone }: { icon: IconName; text: string; tone?: "warn" | "alert" }) {
  const theme = useTheme();
  const color = tone === "alert" ? theme.status.dirty : tone === "warn" ? theme.status.pickup : theme.textMuted;
  return (
    <View style={styles.fact}>
      <Ionicons name={icon} size={13} color={color} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.factText, { color }]} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

export function Panel({ children, testID }: { children: ReactNode; testID?: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.panel, { backgroundColor: theme.surface, borderColor: theme.border }]} testID={testID}>
      {children}
    </View>
  );
}

export function PanelTitle({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const x = useV2Text();
  return (
    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.panelTitle, x.label, { color: theme.textMuted }]}>
      {children}
    </Text>
  );
}

export function DetailRow({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={styles.detailRow}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.detailLabel, { color: theme.textMuted }]}>
        {label}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} selectable style={[styles.detailValue, { color: theme.textPrimary }]}>
        {value}
      </Text>
    </View>
  );
}

/** A tappable chip used for the in-screen section switcher and the filter pills. */
export function Pill({ label, selected, onPress, testID, count }: { label: string; selected: boolean; onPress: () => void; testID?: string; count?: number }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={count != null ? `${label}, ${count}` : label}
      testID={testID}
      style={[
        styles.pill,
        { borderColor: selected ? theme.primaryAction : theme.border, backgroundColor: selected ? theme.primarySoft : theme.surface },
      ]}
    >
      <Text maxFontSizeMultiplier={1.3} style={[styles.pillText, { color: selected ? theme.primary : theme.textSecondary }]}>
        {label}
        {count != null && count > 0 ? `  ${count}` : ""}
      </Text>
    </Pressable>
  );
}

/** One quiet line telling the person the data on screen may be old. */
export function StaleNote({ children, testID }: { children: ReactNode; testID?: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.stale, { backgroundColor: theme.status.pickupSoft }]} accessibilityLiveRegion="polite" testID={testID}>
      <Ionicons name="cloud-offline-outline" size={14} color={theme.status.pickup} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.staleText, { color: theme.textPrimary }]}>
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 },
  badgeText: { fontSize: 12, fontWeight: "700" },
  fact: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 },
  factText: { fontSize: 12, flexShrink: 1 },
  panel: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 10 },
  panelTitle: { fontSize: 12, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" },
  detailRow: { flexDirection: "row", justifyContent: "space-between", gap: 14 },
  detailLabel: { fontSize: 13, flexShrink: 0 },
  detailValue: { fontSize: 13.5, fontWeight: "600", flex: 1, textAlign: "right" },
  pill: { minHeight: 44, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  pillText: { fontSize: 14, fontWeight: "600" },
  stale: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12 },
  staleText: { fontSize: 12.5, flex: 1 },
});
