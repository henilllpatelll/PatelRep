import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { monoFont } from "@/components/shared/tokens";
import { ProgressBar } from "@/components/shared/evening";
import type { DashboardProgress, DashboardTab } from "@/lib/housekeeping/myRoomsDashboard";

const MAX_FONT_SCALE = 1.5;
const TABS: DashboardTab[] = ["route", "floors", "done"];

export interface SyncIndicator {
  key: string;
  icon: "cloud-offline-outline" | "cloud-done-outline" | "sync-outline" | "alert-circle-outline";
  text: string;
  tone: "ok" | "warn";
}

interface MyRoomsHeaderProps {
  dateLabel: string;
  progress: DashboardProgress;
  indicators: SyncIndicator[];
  tab: DashboardTab;
  onTabChange: (tab: DashboardTab) => void;
  topInset: number;
}

export function MyRoomsHeader({ dateLabel, progress, indicators, tab, onTabChange, topInset }: MyRoomsHeaderProps) {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <View
      style={[
        styles.header,
        { backgroundColor: theme.shell.bg, borderBottomColor: theme.shell.line, paddingTop: topInset + 12 },
      ]}
    >
      <View style={styles.titleRow}>
        <View style={styles.titleBlock}>
          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            accessibilityRole="header"
            style={[styles.title, { color: theme.shell.ink }]}
          >
            {t("rooms.title")}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.date, { color: theme.shell.ink3 }]}>
            {dateLabel}
          </Text>
        </View>
      </View>

      {indicators.length > 0 ? (
        <View style={styles.indicators} accessibilityLiveRegion="polite">
          {indicators.map((item) => {
            const color = item.tone === "warn" ? theme.status.pickup : theme.shell.ink3;
            return (
              <View key={item.key} style={styles.indicator}>
                <Ionicons name={item.icon} size={14} color={color} />
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.indicatorText, { color }]}>
                  {item.text}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}

      <View
        style={[styles.summary, { backgroundColor: theme.shell.surface, borderColor: theme.shell.line }]}
        accessible
        accessibilityLabel={
          progress.serviceable > 0
            ? t("rooms.dash.progressA11y", {
                completed: progress.completed,
                total: progress.serviceable,
                percent: progress.percent,
              })
            : t("rooms.dash.progressNone")
        }
      >
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.eyebrow, { color: theme.shell.ink3 }]}>
          {t("rooms.dash.progressTitle")}
        </Text>
        <View style={styles.progressRow}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.progressText, { color: theme.shell.ink }]}>
            {progress.serviceable > 0
              ? t("rooms.dash.progressOf", { completed: progress.completed, total: progress.serviceable })
              : t("rooms.dash.progressNone")}
          </Text>
          {progress.serviceable > 0 ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.percent, { color: theme.shell.ink3 }]}>
              {progress.percent}%
            </Text>
          ) : null}
        </View>
        {progress.serviceable > 0 ? (
          <ProgressBar value={progress.completed} total={progress.serviceable} color={theme.status.ready} />
        ) : null}
        <View style={styles.chips}>
          <Count label={t("rooms.dash.chips.toClean")} value={progress.workable} />
          <Count label={t("rooms.dash.chips.attention")} value={progress.attention} emphasize={progress.attention > 0} />
          <Count label={t("rooms.dash.chips.completed")} value={progress.completed} />
          {progress.unavailable > 0 ? (
            <Count label={t("rooms.dash.chips.unavailable")} value={progress.unavailable} />
          ) : null}
        </View>
      </View>

      <View
        accessibilityRole="tablist"
        accessibilityLabel={t("rooms.dash.tabs.label")}
        style={[styles.segmented, { backgroundColor: theme.shell.surface, borderColor: theme.shell.line }]}
      >
        {TABS.map((key) => {
          const active = tab === key;
          const label = t(`rooms.dash.tabs.${key}`);
          return (
            <Pressable
              key={key}
              onPress={() => onTabChange(key)}
              accessibilityRole="tab"
              accessibilityLabel={label}
              accessibilityState={{ selected: active }}
              testID={`my-rooms-tab-${key}`}
              style={[styles.segment, active && { backgroundColor: theme.shell.raised }]}
            >
              <Text
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                style={[styles.segmentText, { color: active ? theme.shell.ink : theme.shell.ink3 }]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function Count({ label, value, emphasize }: { label: string; value: number; emphasize?: boolean }) {
  const theme = useTheme();
  return (
    <View style={styles.count} accessible accessibilityLabel={`${label} ${value}`}>
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={[styles.countValue, { color: emphasize ? theme.status.pickup : theme.shell.ink }]}
      >
        {value}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.countLabel, { color: theme.shell.ink3 }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { borderBottomWidth: 1, paddingHorizontal: 18, paddingBottom: 14, gap: 10 },
  titleRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 12 },
  titleBlock: { flex: 1, minWidth: 0 },
  title: { fontSize: 28, fontWeight: "700", lineHeight: 33 },
  date: { fontSize: 13, marginTop: 2 },
  indicators: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  indicator: { flexDirection: "row", alignItems: "center", gap: 5 },
  indicatorText: { fontSize: 12.5, fontWeight: "600" },
  summary: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 8 },
  eyebrow: { fontSize: 11, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" },
  progressRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 },
  progressText: { flexShrink: 1, fontSize: 18, fontWeight: "800" },
  percent: { fontFamily: monoFont, fontSize: 14, fontWeight: "800" },
  chips: { flexDirection: "row", flexWrap: "wrap", columnGap: 18, rowGap: 6 },
  count: { flexDirection: "row", alignItems: "baseline", gap: 5 },
  countValue: { fontFamily: monoFont, fontSize: 16, fontWeight: "800" },
  countLabel: { fontSize: 12.5, fontWeight: "600" },
  segmented: { flexDirection: "row", gap: 4, borderWidth: 1, borderRadius: 12, padding: 3 },
  segment: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 44, borderRadius: 9 },
  segmentText: { fontSize: 14, fontWeight: "800" },
});
