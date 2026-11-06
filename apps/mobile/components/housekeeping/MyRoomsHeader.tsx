import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { ProgressBar } from "@/components/shared/evening";
import { radiusV2, spaceV2 } from "@/components/shared/tokensV2";
import { AppText } from "@/components/ui/AppText";
import { Card } from "@/components/ui/Card";
import { LinearProgress } from "@/components/ui/LinearProgress";
import { useIsDesignV2 } from "@/lib/design/DesignV2Scope";
import type { DashboardProgress, DashboardTab } from "@/lib/housekeeping/myRoomsDashboard";
import { createTypographyStyles } from "@/lib/design/reactiveTypography";

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

export function MyRoomsHeader(props: MyRoomsHeaderProps) {
  return useIsDesignV2() ? <MyRoomsHeaderV2 {...props} /> : <MyRoomsHeaderLegacy {...props} />;
}

/** Design System V2: a light page header (title, date), honest sync chips, one progress card and a segmented list switch. */
function MyRoomsHeaderV2({ dateLabel, progress, indicators, tab, onTabChange, topInset }: MyRoomsHeaderProps) {
  const styles = useStyles();
  const { t } = useTranslation();
  const theme = useTheme();
  const summaryLabel =
    progress.serviceable > 0
      ? t("rooms.dash.progressA11y", { completed: progress.completed, total: progress.serviceable, percent: progress.percent })
      : t("rooms.dash.progressNone");
  return (
    <View style={[styles.headerV2, { backgroundColor: theme.background, paddingTop: topInset + spaceV2.sm }]}>
      <View>
        <AppText variant="title" accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {t("rooms.title")}
        </AppText>
        <AppText variant="caption" tone="secondary" maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {dateLabel}
        </AppText>
      </View>

      {indicators.length > 0 ? (
        <View style={styles.indicatorsV2} accessibilityLiveRegion="polite">
          {indicators.map((item) => {
            const warn = item.tone === "warn";
            const fg = warn ? theme.status.pickup : theme.status.ready;
            return (
              <View
                key={item.key}
                style={[
                  styles.indicatorChipV2,
                  {
                    backgroundColor: warn ? theme.status.pickupSoft : theme.status.readySoft,
                    borderColor: warn ? theme.status.pickupLine : theme.status.readyLine,
                  },
                ]}
              >
                <Ionicons name={item.icon} size={14} color={fg} />
                <AppText variant="caption" maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.indicatorTextV2}>
                  {item.text}
                </AppText>
              </View>
            );
          })}
        </View>
      ) : null}

      <Card style={styles.summaryV2} testID="my-rooms-summary">
        <View accessible accessibilityLabel={summaryLabel} style={styles.summaryInnerV2}>
          <View style={styles.summaryTop}>
            <AppText variant="label" tone="secondary" accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {t("rooms.dash.progressTitle")}
            </AppText>
            {progress.serviceable > 0 ? (
              <AppText variant="label" tone="secondary" numeric maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {progress.percent}%
              </AppText>
            ) : null}
          </View>
          <AppText variant="headline" numeric maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {progress.serviceable > 0
              ? t("rooms.dash.progressOf", { completed: progress.completed, total: progress.serviceable })
              : t("rooms.dash.progressNone")}
          </AppText>
          {progress.serviceable > 0 ? (
            <LinearProgress value={progress.completed} total={progress.serviceable} tone="ready" accessibilityLabel={summaryLabel} />
          ) : null}
        </View>
        <View style={styles.countsV2}>
          <CountV2 label={t("rooms.dash.chips.toClean")} value={progress.workable} />
          <CountV2 label={t("rooms.dash.chips.attention")} value={progress.attention} emphasize={progress.attention > 0} />
          <CountV2 label={t("rooms.dash.chips.completed")} value={progress.completed} />
          {progress.unavailable > 0 ? <CountV2 label={t("rooms.dash.chips.unavailable")} value={progress.unavailable} /> : null}
        </View>
      </Card>

      <View
        accessibilityRole="tablist"
        accessibilityLabel={t("rooms.dash.tabs.label")}
        style={[styles.segmentedV2, { backgroundColor: theme.surfaceSubtle }]}
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
              style={[
                styles.segmentV2,
                active && { backgroundColor: theme.surface, borderColor: theme.borderSubtle, borderWidth: 1 },
              ]}
            >
              <AppText
                variant="label"
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                style={{ color: active ? theme.textPrimary : theme.textSecondary, fontWeight: active ? "700" : "600" }}
              >
                {label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function CountV2({ label, value, emphasize }: { label: string; value: number; emphasize?: boolean }) {
  const styles = useStyles();
  const theme = useTheme();
  return (
    <View style={styles.countV2} accessible accessibilityLabel={`${label} ${value}`}>
      <AppText variant="headline" numeric maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: emphasize ? theme.status.pickup : theme.textPrimary }}>
        {value}
      </AppText>
      <AppText variant="caption" tone="secondary" maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {label}
      </AppText>
    </View>
  );
}

function MyRoomsHeaderLegacy({ dateLabel, progress, indicators, tab, onTabChange, topInset }: MyRoomsHeaderProps) {
  const styles = useStyles();
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
  const styles = useStyles();
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

const useStyles = createTypographyStyles((t) => ({
  headerV2: { paddingHorizontal: spaceV2.page, paddingBottom: spaceV2.md, gap: spaceV2.md },
  indicatorsV2: { flexDirection: "row", flexWrap: "wrap", gap: spaceV2.sm },
  indicatorChipV2: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: radiusV2.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  indicatorTextV2: { flexShrink: 1 },
  summaryV2: { padding: spaceV2.lg, gap: spaceV2.md },
  summaryInnerV2: { gap: 6 },
  summaryTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spaceV2.sm },
  countsV2: { flexDirection: "row", flexWrap: "wrap", columnGap: spaceV2.xl, rowGap: spaceV2.sm },
  countV2: { minWidth: 64 },
  segmentedV2: { flexDirection: "row", gap: 4, borderRadius: radiusV2.control, padding: 4 },
  segmentV2: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 44, borderRadius: radiusV2.input, borderWidth: 1, borderColor: "transparent" },
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
  percent: { fontFamily: t.mono, fontSize: 14, fontWeight: "800" },
  chips: { flexDirection: "row", flexWrap: "wrap", columnGap: 18, rowGap: 6 },
  count: { flexDirection: "row", alignItems: "baseline", gap: 5 },
  countValue: { fontFamily: t.mono, fontSize: 16, fontWeight: "800" },
  countLabel: { fontSize: 12.5, fontWeight: "600" },
  segmented: { flexDirection: "row", gap: 4, borderWidth: 1, borderRadius: 12, padding: 3 },
  segment: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 44, borderRadius: 9 },
  segmentText: { fontSize: 14, fontWeight: "800" },
}));
