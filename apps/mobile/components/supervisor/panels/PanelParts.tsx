import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { monoFont, R } from "@/components/shared/tokens";
import { Button } from "@/components/ui/Button";
import type { PanelLoadError } from "@/lib/housekeeping/roomPanelErrors";
import { useTheme } from "@/lib/theme/useTheme";

/* Shared pieces of the Room Board drawers' inner views: header, honest loading / error states, small cards.
   Everything draws what it is given; no fetching and no rules live here. */

type Translate = (key: string, options?: Record<string, unknown>) => string;

export function PanelHeader({
  title,
  onBack,
  onClose,
  backDisabled,
  testID,
}: {
  title: string;
  onBack: () => void;
  onClose: () => void;
  backDisabled?: boolean;
  testID?: string;
}) {
  const theme = useTheme();
  const { t } = useTranslationLite();
  return (
    <View style={styles.header} testID={testID}>
      <Pressable
        onPress={onBack}
        disabled={backDisabled}
        accessibilityRole="button"
        accessibilityLabel={t("common.back")}
        accessibilityState={{ disabled: !!backDisabled }}
        hitSlop={6}
        style={[styles.iconButton, backDisabled && styles.dim]}
        testID="panel-back"
      >
        <Ionicons name="chevron-back" size={22} color={theme.textPrimary} />
      </Pressable>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]} testID="panel-title">
        {title}
      </Text>
      <Pressable
        onPress={onClose}
        disabled={backDisabled}
        accessibilityRole="button"
        accessibilityLabel={t("common.close")}
        hitSlop={6}
        style={[styles.iconButton, { backgroundColor: theme.surfaceSubtle }, backDisabled && styles.dim]}
        testID="panel-close"
      >
        <Ionicons name="close" size={22} color={theme.textPrimary} />
      </Pressable>
    </View>
  );
}

function useTranslationLite() {
  const { t } = useTranslation();
  return { t: t as Translate };
}

export function LoadingBlock({ label, testID = "panel-loading" }: { label: string; testID?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.center} accessibilityRole="progressbar" accessibilityLabel={label} testID={testID}>
      <ActivityIndicator color={theme.primaryAction} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textMuted }]}>{label}</Text>
    </View>
  );
}

export function ErrorBlock({ error, onRetry, t, testID = "panel-error" }: { error: PanelLoadError; onRetry: () => void; t: Translate; testID?: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]} accessibilityRole="alert" testID={testID}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.cardTitle, { color: theme.textPrimary }]}>{t(`roomBoard.panel.error.${error}.title`)}</Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>{t(`roomBoard.panel.error.${error}.body`)}</Text>
      {error !== "unauthorized" && error !== "not_found" ? (
        <Button label={t("roomBoard.panel.retry")} icon="refresh" variant="secondary" size="sm" onPress={onRetry} testID="panel-retry" />
      ) : null}
    </View>
  );
}

export function EmptyBlock({ title, body, testID = "panel-empty" }: { title: string; body?: string; testID?: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]} testID={testID}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.cardTitle, { color: theme.textPrimary }]}>{title}</Text>
      {body ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>{body}</Text> : null}
    </View>
  );
}

export function InfoCard({ children, tone = "neutral", testID }: { children: ReactNode; tone?: "neutral" | "warn"; testID?: string }) {
  const theme = useTheme();
  return (
    <View
      style={[styles.card, { backgroundColor: tone === "warn" ? theme.status.pickupSoft : theme.surfaceMuted, borderColor: tone === "warn" ? theme.status.pickupLine : theme.border }]}
      testID={testID}
    >
      {children}
    </View>
  );
}

export function Pill({ label, color, bg, line }: { label: string; color: string; bg: string; line: string }) {
  return (
    <View style={[styles.pill, { backgroundColor: bg, borderColor: line }]}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.pillText, { color }]}>{label}</Text>
    </View>
  );
}

export function SegmentTabs<K extends string>({
  tabs,
  selected,
  onSelect,
}: {
  tabs: Array<{ key: K; label: string }>;
  selected: K;
  onSelect: (key: K) => void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.segments, { backgroundColor: theme.surfaceMuted }]}>
      {tabs.map((tab) => {
        const active = tab.key === selected;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onSelect(tab.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={[styles.segment, active && { backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1 }]}
            testID={`panel-tab-${tab.key}`}
          >
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.segmentText, { color: active ? theme.textPrimary : theme.textMuted }]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export const panelStyles = StyleSheet.create({
  scroll: { flexGrow: 0, marginTop: 10 },
  content: { gap: 12, paddingBottom: 12 },
  footer: { gap: 8, paddingTop: 8 },
  mono: { fontFamily: monoFont },
});

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { flex: 1, fontSize: 15, fontWeight: "800", letterSpacing: 0.4 },
  iconButton: { minWidth: 44, minHeight: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  dim: { opacity: 0.4 },
  center: { alignItems: "center", gap: 8, paddingVertical: 28 },
  muted: { fontSize: 13 },
  card: { borderWidth: 1, borderRadius: R.lg, padding: 13, gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: "700" },
  body: { fontSize: 13.5, lineHeight: 19 },
  pill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3.5 },
  pillText: { fontSize: 11, fontWeight: "800" },
  segments: { flexDirection: "row", borderRadius: R.md, padding: 3, gap: 3 },
  segment: { flex: 1, minHeight: 40, borderRadius: R.md - 3, alignItems: "center", justifyContent: "center" },
  segmentText: { fontSize: 13, fontWeight: "700" },
});
