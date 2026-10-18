import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { SheetNotice } from "@/components/home/sheetParts";
import { R } from "@/components/shared/tokens";
import { Button } from "@/components/ui/Button";
import type { HandoffNotice } from "@/lib/housekeeping/useShiftHandoff";
import {
  HANDOFF_STEPS,
  type HandoffBlocker,
  type HandoffReport,
  type HandoffStep,
} from "@/lib/housekeeping/supervisorHandoff";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/* ─── Step indicator ──────────────────────────────────────────────────────── */

export function StepIndicator({ step, t }: { step: Exclude<HandoffStep, "saved">; t: Translate }) {
  const theme = useTheme();
  const current = HANDOFF_STEPS.indexOf(step);
  return (
    <View
      style={styles.steps}
      accessible
      accessibilityLabel={t("supervisorHandoff.stepLabel", {
        current: current + 1,
        total: HANDOFF_STEPS.length,
        name: t(`supervisorHandoff.steps.${step}`),
      })}
      testID="handoff-steps"
    >
      {HANDOFF_STEPS.map((name, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <View key={name} style={styles.stepItem}>
            <View
              style={[
                styles.stepDot,
                {
                  backgroundColor: done || active ? theme.primaryAction : theme.surfaceSubtle,
                  borderColor: done || active ? theme.primaryAction : theme.border,
                },
              ]}
            >
              {done ? (
                <Ionicons name="checkmark" size={13} color={theme.onPrimary} />
              ) : (
                <Text style={[styles.stepNumber, { color: active ? theme.onPrimary : theme.textMuted }]}>{index + 1}</Text>
              )}
            </View>
            <Text
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              numberOfLines={1}
              style={[styles.stepName, { color: active ? theme.textPrimary : theme.textMuted, fontWeight: active ? "800" : "600" }]}
            >
              {t(`supervisorHandoff.steps.${name}`)}
            </Text>
            {index < HANDOFF_STEPS.length - 1 ? <View style={[styles.stepRule, { backgroundColor: done ? theme.primaryAction : theme.border }]} /> : null}
          </View>
        );
      })}
    </View>
  );
}

/* ─── Section frame ───────────────────────────────────────────────────────── */

export function Section({ title, children, testID, action }: { title: string; children: React.ReactNode; testID?: string; action?: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.section} testID={testID}>
      <View style={styles.sectionHead}>
        <Text accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sectionTitle, { color: theme.textMuted }]}>
          {title.toUpperCase()}
        </Text>
        {action}
      </View>
      {children}
    </View>
  );
}

/* ─── Housekeeping summary ────────────────────────────────────────────────── */

function Metric({
  label,
  value,
  caption,
  tone,
  testID,
  large = true,
  t,
}: {
  label: string;
  value: number | null;
  caption?: string | null;
  tone?: string;
  testID: string;
  large?: boolean;
  t: Translate;
}) {
  const theme = useTheme();
  const known = value !== null;
  return (
    <View
      style={[styles.metric, { backgroundColor: theme.surface, borderColor: theme.borderSubtle }]}
      testID={testID}
      accessible
      accessibilityLabel={`${label}: ${known ? value : t("supervisorHandoff.summary.unverified")}${caption ? `, ${caption}` : ""}`}
    >
      <Text
        maxFontSizeMultiplier={1.3}
        style={[large ? styles.metricValue : styles.metricValueSmall, { color: known && tone ? tone : theme.textPrimary }]}
      >
        {known ? value : "—"}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.metricLabel, { color: theme.textSecondary }]} numberOfLines={2}>
        {label}
      </Text>
      {caption || !known ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.metricCaption, { color: theme.textMuted }]} numberOfLines={2}>
          {known ? caption : t("supervisorHandoff.summary.unverified")}
        </Text>
      ) : null}
    </View>
  );
}

/** Snapshot figures and inspection ACTIVITY side by side, each labelled for what it is. Unknown shows "—", never 0. */
export function SummaryGrid({ report, t }: { report: HandoffReport; t: Translate }) {
  const theme = useTheme();
  const rooms = report.rooms;
  const inspections = report.inspections;
  return (
    <View style={styles.grid} testID="handoff-summary">
      <View style={styles.gridRow}>
        <Metric
          t={t}
          testID="handoff-ready"
          label={t("supervisorHandoff.summary.ready")}
          value={rooms ? rooms.ready : null}
          caption={rooms ? t("supervisorHandoff.summary.readyOf", { count: rooms.inService }) : null}
          tone={theme.status.ready}
        />
        <Metric t={t} testID="handoff-passed" label={t("supervisorHandoff.summary.passed")} value={inspections ? inspections.passed : null} tone={theme.status.ready} />
      </View>
      <View style={styles.gridRow}>
        <Metric t={t} testID="handoff-failed" label={t("supervisorHandoff.summary.failed")} value={inspections ? inspections.failed : null} tone={theme.status.dirty} />
        <Metric t={t} testID="handoff-awaiting" label={t("supervisorHandoff.summary.awaiting")} value={rooms ? rooms.awaitingInspection : null} tone={theme.status.clean} />
      </View>
      <View style={styles.gridRow}>
        <Metric t={t} large={false} testID="handoff-conditional" label={t("supervisorHandoff.summary.conditional")} value={inspections ? inspections.conditional : null} />
        <Metric t={t} large={false} testID="handoff-in-progress" label={t("supervisorHandoff.summary.inProgress")} value={rooms ? rooms.inProgress : null} />
      </View>
      <View style={styles.gridRow}>
        <Metric t={t} large={false} testID="handoff-to-clean" label={t("supervisorHandoff.summary.toClean")} value={rooms ? rooms.toClean : null} />
        <Metric t={t} large={false} testID="handoff-ooo" label={t("supervisorHandoff.summary.outOfOrder")} value={rooms ? rooms.outOfOrder : null} />
      </View>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.scope, { color: theme.textMuted }]}>
        {t("supervisorHandoff.summary.scope")}
      </Text>
    </View>
  );
}

/* ─── Unfinished work ─────────────────────────────────────────────────────── */

function roomsLine(numbers: string[], total: number, t: Translate): string {
  const more = total - numbers.length;
  const list = numbers.join(", ");
  return t("supervisorHandoff.unfinished.rooms", { rooms: more > 0 ? `${list} ${t("supervisorHandoff.unfinished.moreRooms", { count: more })}` : list });
}

function Item({ icon, color, title, detail, testID }: { icon: React.ComponentProps<typeof Ionicons>["name"]; color: string; title: string; detail?: string | null; testID: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.item, { backgroundColor: theme.surface, borderColor: theme.borderSubtle }]} testID={testID} accessible accessibilityLabel={detail ? `${title}. ${detail}` : title}>
      <Ionicons name={icon} size={20} color={color} style={styles.itemIcon} />
      <View style={styles.itemText}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.itemTitle, { color: theme.textPrimary }]}>
          {title}
        </Text>
        {detail ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.itemDetail, { color: theme.textSecondary }]}>
            {detail}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** Only what the records support: awaiting inspection, unassigned rooms, active housekeeping blockers. */
export function UnfinishedList({ report, t }: { report: HandoffReport; t: Translate }) {
  const theme = useTheme();
  const rooms = report.rooms;
  const unresolved = report.unresolved;
  if (!rooms || !unresolved) {
    return <SheetNotice tone="warn" text={t("supervisorHandoff.summary.unverified")} testID="handoff-unfinished-unverified" />;
  }
  const rows: React.ReactNode[] = [];
  if (rooms.awaitingInspection > 0) {
    rows.push(
      <Item
        key="awaiting"
        testID="handoff-item-awaiting"
        icon="search-outline"
        color={theme.status.clean}
        title={t("supervisorHandoff.unfinished.awaiting", { count: rooms.awaitingInspection })}
        detail={unresolved.awaitingInspectionRoomNumbers.length ? roomsLine(unresolved.awaitingInspectionRoomNumbers, rooms.awaitingInspection, t) : null}
      />,
    );
  }
  if (unresolved.unassignedRooms > 0) {
    rows.push(
      <Item
        key="unassigned"
        testID="handoff-item-unassigned"
        icon="person-add-outline"
        color={theme.status.pickup}
        title={t("supervisorHandoff.unfinished.unassigned", { count: unresolved.unassignedRooms })}
        detail={unresolved.unassignedRoomNumbers.length ? roomsLine(unresolved.unassignedRoomNumbers, unresolved.unassignedRooms, t) : null}
      />,
    );
  }
  if (unresolved.blockedTasks !== null && unresolved.blockedTasks > 0) {
    rows.push(
      <Item key="blocked" testID="handoff-item-blocked" icon="hand-left-outline" color={theme.status.dirty} title={t("supervisorHandoff.unfinished.blocked", { count: unresolved.blockedTasks })} />,
    );
  }
  return (
    <View style={styles.items} testID="handoff-unfinished">
      {rows.length === 0 && unresolved.blockedTasks !== null ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.itemDetail, { color: theme.textSecondary }]} testID="handoff-unfinished-none">
          {t("supervisorHandoff.unfinished.none")}
        </Text>
      ) : null}
      {rows}
      {unresolved.blockedTasks === null ? <SheetNotice tone="warn" text={t("supervisorHandoff.unfinished.blockedUnverified")} testID="handoff-blocked-unverified" /> : null}
    </View>
  );
}

/* ─── Why the report can't be sent yet ────────────────────────────────────── */

export function BlockerNotice({
  blockers,
  isOnline,
  refreshing,
  onRefresh,
  t,
}: {
  blockers: HandoffBlocker[];
  isOnline: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  t: Translate;
}) {
  if (blockers.length === 0) return null;
  const loadingOnly = blockers.every((b) => b === "boardLoading" || b === "inspectionsLoading");
  return (
    <View style={styles.blockers} testID="handoff-blockers">
      {!isOnline ? <SheetNotice tone="warn" text={t("supervisorHandoff.blockers.offline")} testID="handoff-offline" /> : null}
      {blockers.map((blocker) => (
        <SheetNotice key={blocker} tone="warn" text={t(`supervisorHandoff.blockers.${blocker}`)} testID={`handoff-blocker-${blocker}`} />
      ))}
      {isOnline && !loadingOnly ? (
        <Button label={t("supervisorHandoff.actions.refresh")} onPress={onRefresh} loading={refreshing} variant="secondary" size="sm" icon="refresh" testID="handoff-refresh" />
      ) : null}
    </View>
  );
}

/* ─── Failure / status words ──────────────────────────────────────────────── */

export function noticeText(notice: HandoffNotice, t: Translate): { text: string; tone: "info" | "warn" | "error" } {
  switch (notice.kind) {
    case "countsChanged":
      return { text: t("supervisorHandoff.failure.countsChanged"), tone: "warn" };
    case "departmentMissing":
      return { text: t("supervisorHandoff.failure.departmentMissing"), tone: "error" };
    case "departmentAmbiguous":
      return { text: t("supervisorHandoff.failure.departmentAmbiguous"), tone: "error" };
    case "dateOutOfRange":
      return { text: t("supervisorHandoff.failure.dateOutOfRange"), tone: "warn" };
    case "forbidden":
      return { text: t("supervisorHandoff.failure.forbidden"), tone: "error" };
    case "signedOut":
      return { text: t("supervisorHandoff.failure.signedOut"), tone: "error" };
    case "rejected":
      return { text: t("supervisorHandoff.failure.rejected"), tone: "error" };
    case "unconfirmed":
      return { text: t("supervisorHandoff.failure.unconfirmed"), tone: "warn" };
    case "notSaved":
      return { text: t("supervisorHandoff.failure.notSaved"), tone: "info" };
    case "verifyFailed":
      return { text: `${t("supervisorHandoff.failure.unconfirmed")} ${t("supervisorHandoff.failure.verifyFailed")}`, tone: "warn" };
    case "notifyFailed":
      return { text: t("supervisorHandoff.failure.notifyFailed"), tone: "warn" };
  }
}

/* ─── Review checkbox ─────────────────────────────────────────────────────── */

export function AckRow({ checked, onChange, disabled, label }: { checked: boolean; onChange: (next: boolean) => void; disabled: boolean; label: string }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => onChange(!checked)}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      accessibilityLabel={label}
      testID="handoff-ack"
      style={[styles.ack, { backgroundColor: theme.surface, borderColor: checked ? theme.primaryAction : theme.border, opacity: disabled ? 0.55 : 1 }]}
    >
      <View style={[styles.box, { borderColor: checked ? theme.primaryAction : theme.textMuted, backgroundColor: checked ? theme.primaryAction : "transparent" }]}>
        {checked ? <Ionicons name="checkmark" size={16} color={theme.onPrimary} /> : null}
      </View>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.ackText, { color: theme.textPrimary }]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function MetaRow({ label, value, testID }: { label: string; value: string; testID?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.metaRow} testID={testID} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.metaLabel, { color: theme.textMuted }]}>
        {label}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.metaValue, { color: theme.textPrimary }]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  steps: { flexDirection: "row", alignItems: "center", paddingVertical: 4 },
  stepItem: { flexDirection: "row", alignItems: "center", flex: 1, gap: 6 },
  stepDot: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  stepNumber: { fontSize: 12, fontWeight: "800" },
  stepName: { fontSize: 13, flexShrink: 1 },
  stepRule: { flex: 1, height: 2, borderRadius: 1, marginHorizontal: 2 },
  section: { gap: 10, marginTop: 18 },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { fontSize: 11.5, fontWeight: "800", letterSpacing: 1 },
  grid: { gap: 8 },
  gridRow: { flexDirection: "row", gap: 8 },
  metric: { flex: 1, borderWidth: 1, borderRadius: R.lg, paddingVertical: 12, paddingHorizontal: 12, gap: 2, minWidth: 0 },
  metricValue: { fontSize: 30, lineHeight: 34, fontWeight: "700" },
  metricValueSmall: { fontSize: 20, lineHeight: 24, fontWeight: "700" },
  metricLabel: { fontSize: 12.5, fontWeight: "600" },
  metricCaption: { fontSize: 11.5 },
  scope: { fontSize: 12, lineHeight: 16 },
  items: { gap: 8 },
  item: { flexDirection: "row", gap: 10, borderWidth: 1, borderRadius: R.lg, padding: 12, alignItems: "flex-start" },
  itemIcon: { marginTop: 1 },
  itemText: { flex: 1, gap: 2 },
  itemTitle: { fontSize: 14.5, fontWeight: "700" },
  itemDetail: { fontSize: 13, lineHeight: 18 },
  blockers: { gap: 8, marginTop: 14 },
  ack: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1.5, borderRadius: R.lg, padding: 14, minHeight: 56 },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  ackText: { flex: 1, fontSize: 14.5, fontWeight: "600", lineHeight: 20 },
  metaRow: { flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 4 },
  metaLabel: { fontSize: 13, flexShrink: 0 },
  metaValue: { fontSize: 13, fontWeight: "600", flex: 1, textAlign: "right" },
});
