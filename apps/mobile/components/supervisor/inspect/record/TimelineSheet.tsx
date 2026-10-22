import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { Button } from "@/components/ui/Button";
import { WorkspaceSheet } from "@/components/supervisor/inspect/workspace/WorkspaceSheet";
import { buildTimelineLines, type TimelineLine } from "@/lib/inspections/history/timeline";
import type { Load } from "@/lib/inspections/history/useInspectionRecord";
import type { InspectionTimeline } from "@/lib/api/inspectionHistory";
import type { Translate } from "@/lib/inspections/viewText";
import { useTheme } from "@/lib/theme/useTheme";

/**
 * ROOM 205 · CORRECTION HISTORY. Read-only. Only things the database timestamped are listed, oldest first; a step that
 * left no trace is not invented. A line that is an inspection opens that inspection's record.
 */
export function TimelineSheet({
  visible,
  roomNumber,
  currentId,
  state,
  timeZone,
  language,
  t,
  onRetry,
  onOpenInspection,
  onClose,
}: {
  visible: boolean;
  roomNumber: string | null;
  currentId: string;
  state: Load<InspectionTimeline>;
  timeZone: string | null | undefined;
  language: string;
  t: Translate;
  onRetry: () => void;
  onOpenInspection: (id: string) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const lines = useMemo(
    () => (state.status === "ready" ? buildTimelineLines(state.data, { currentId, timeZone, language, t }) : []),
    [state, currentId, timeZone, language, t],
  );
  return (
    <WorkspaceSheet
      visible={visible}
      title={t("inspect.history.timeline.title", { room: roomNumber ?? "—" })}
      onClose={onClose}
      onBackdrop={onClose}
      closeLabel={t("inspect.record.close")}
      testID="timeline-sheet"
      t={t}
    >
      {state.status === "idle" || state.status === "loading" ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="progressbar" style={[styles.muted, { color: theme.textMuted }]} testID="timeline-loading">
          {t("inspect.record.loading")}
        </Text>
      ) : state.status === "failed" ? (
        <View style={styles.block} accessibilityRole="alert" testID="timeline-failed">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.status.dirty }]}>
            {t(`inspect.history.timeline.failure.${state.failure}`)}
          </Text>
          {state.failure !== "forbidden" && state.failure !== "not_found" ? <Button label={t("inspect.record.retry")} variant="secondary" size="sm" onPress={onRetry} testID="timeline-retry" /> : null}
        </View>
      ) : lines.length === 0 ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textSecondary }]} testID="timeline-empty">
          {t("inspect.history.timeline.empty")}
        </Text>
      ) : (
        <View style={styles.list} testID="timeline-list">
          {state.stale ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.status.pickup }]} testID="timeline-stale">
              {t("inspect.history.timeline.stale")}
            </Text>
          ) : null}
          {lines.map((line, index) => (
            <Line key={line.key} line={line} last={index === lines.length - 1} t={t} onOpen={onOpenInspection} />
          ))}
          {state.data.truncated ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textMuted }]} testID="timeline-truncated">
              {t("inspect.history.timeline.truncated")}
            </Text>
          ) : null}
        </View>
      )}
    </WorkspaceSheet>
  );
}

function Line({ line, last, t, onOpen }: { line: TimelineLine; last: boolean; t: Translate; onOpen: (id: string) => void }) {
  const theme = useTheme();
  const tone = line.tone === "bad" ? theme.status.dirty : line.tone === "good" ? theme.status.ready : line.tone === "warn" ? theme.status.pickup : theme.textMuted;
  const icon = line.tone === "bad" ? "close-circle" : line.tone === "good" ? "checkmark-circle" : line.tone === "warn" ? "alert-circle" : "ellipse";
  const body = (
    <View style={styles.row}>
      <View style={styles.rail}>
        <Ionicons name={icon} size={line.tone === "neutral" ? 10 : 18} color={tone} />
        {!last ? <View style={[styles.stem, { backgroundColor: theme.border }]} /> : null}
      </View>
      <View style={styles.text}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.textPrimary }]}>
          {line.title}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.time, { color: theme.textMuted }]}>
          {line.time}
        </Text>
        {line.detail ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.detail, { color: theme.textSecondary }]}>
            {line.detail}
          </Text>
        ) : null}
        {line.inspectionId && !line.current ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.link, { color: theme.primaryAction }]}>
            {t("inspect.history.timeline.openRecord")}
          </Text>
        ) : null}
        {line.current ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.time, { color: theme.textMuted }]}>
            {t("inspect.history.timeline.thisRecord")}
          </Text>
        ) : null}
      </View>
    </View>
  );
  const label = [line.title, line.time, line.detail].filter(Boolean).join(", ");
  if (line.inspectionId && !line.current) {
    return (
      <Pressable onPress={() => onOpen(line.inspectionId!)} accessibilityRole="button" accessibilityLabel={`${label}. ${t("inspect.history.timeline.openRecord")}`} testID={`timeline-line-${line.key}`} style={{ minHeight: MIN_TARGET }}>
        {body}
      </Pressable>
    );
  }
  return (
    <View accessible accessibilityLabel={label} testID={`timeline-line-${line.key}`}>
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  muted: { fontSize: 13.5, lineHeight: 19 },
  block: { gap: 8, alignItems: "flex-start" },
  list: { gap: 0 },
  row: { flexDirection: "row", gap: 12 },
  rail: { width: 20, alignItems: "center" },
  stem: { flex: 1, width: 2, marginTop: 2, borderRadius: 1, minHeight: 14 },
  text: { flex: 1, minWidth: 0, paddingBottom: 14, gap: 1 },
  title: { fontSize: 15, fontWeight: "800", lineHeight: 21 },
  time: { fontSize: 12.5 },
  detail: { fontSize: 13.5, lineHeight: 19 },
  link: { fontSize: 13, fontWeight: "800", marginTop: 2 },
});
