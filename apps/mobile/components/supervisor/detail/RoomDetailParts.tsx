import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { getStatusMeta } from "@/components/shared/evening";
import { Avatar } from "@/components/shared/mobileHandoff";
import { R } from "@/components/shared/tokens";
import { Button } from "@/components/ui/Button";
import type {
  DetailAction,
  DetailAssignment,
  DetailCleaning,
  DetailException,
  DetailFlag,
  DetailNote,
  DetailRow,
  DetailTone,
  DetailWorkOrder,
} from "@/lib/housekeeping/roomDetailView";
import { useTheme } from "@/lib/theme/useTheme";

/* ─── Room detail — presentational sections ─────────────────────────────────
   One small component per section of the drawer. They only draw a `RoomDetailModel`; every rule about what is
   shown lives in roomDetailView. Status colours come from the protected `getStatusMeta`. */

type Translate = (key: string, options?: Record<string, unknown>) => string;

export function Section({ title, children, testID }: { title: string; children: ReactNode; testID?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.section} testID={testID}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.sectionTitle, { color: theme.textMuted }]}>
        {title}
      </Text>
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>{children}</View>
    </View>
  );
}

export function StatusBadgeLarge({ rawStatus, label }: { rawStatus: string; label: string }) {
  const theme = useTheme();
  const meta = getStatusMeta(rawStatus, theme);
  return (
    <View style={[styles.statusBadge, { backgroundColor: meta.bg, borderColor: meta.border }]} testID="room-detail-status">
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.statusBadgeText, { color: meta.fg }]}>{label}</Text>
    </View>
  );
}

export function FlagChips({ flags }: { flags: DetailFlag[] }) {
  const theme = useTheme();
  const colorOf = (tone: DetailTone) => (tone === "alert" ? theme.status.dirty : tone === "warn" ? theme.status.pickup : theme.textSecondary);
  const bgOf = (tone: DetailTone) => (tone === "alert" ? theme.status.dirtySoft : tone === "warn" ? theme.status.pickupSoft : theme.surfaceSubtle);
  const lineOf = (tone: DetailTone) => (tone === "alert" ? theme.status.dirtyLine : tone === "warn" ? theme.status.pickupLine : theme.borderSubtle);
  return (
    <>
      {flags.map((flag) => (
        <View key={flag.key} style={[styles.flag, { backgroundColor: bgOf(flag.tone), borderColor: lineOf(flag.tone) }]} testID={`room-detail-flag-${flag.key}`}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.flagText, { color: colorOf(flag.tone) }]}>{flag.label}</Text>
        </View>
      ))}
    </>
  );
}

export function FactRows({ rows, testID }: { rows: DetailRow[]; testID?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.rows} testID={testID}>
      {rows.map((row) => (
        <View key={row.key} style={styles.row} testID={`room-detail-row-${row.key}`}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowLabel, { color: theme.textSecondary }]}>{row.label}</Text>
          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={[styles.rowValue, { color: row.muted ? theme.textMuted : theme.textPrimary }]}
          >
            {row.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function AssignmentCard({
  assignment,
  primaryIsAssignment,
  saving,
  onAssign,
  action,
  onViewWorkload,
  t,
}: {
  assignment: DetailAssignment;
  primaryIsAssignment: boolean;
  saving: boolean;
  onAssign: () => void;
  action: DetailAction | null;
  /** Opens this person in Assignments (their rooms and workload). Offered only when the room has an owner. */
  onViewWorkload?: (() => void) | undefined;
  t: Translate;
}) {
  const theme = useTheme();
  const showButton = action !== null && primaryIsAssignment === false && (action.key === "assign" || action.key === "reassign");
  return (
    <View testID="room-detail-assignment">
      <View style={styles.assignRow}>
        {assignment.name ? (
          <Avatar name={assignment.name} size={38} />
        ) : (
          <View style={[styles.assignIcon, { backgroundColor: theme.surfaceSubtle }]}>
            <Ionicons name={assignment.kind === "none" ? "person-add-outline" : "person-outline"} size={18} color={theme.textMuted} />
          </View>
        )}
        <View style={styles.assignBody}>
          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={[styles.assignName, { color: assignment.kind === "none" || assignment.kind === "not_applicable" ? theme.textMuted : theme.textPrimary }]}
            testID="room-detail-assignee"
          >
            {assignment.headline}
          </Text>
          {assignment.workload ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.assignMeta, { color: theme.textSecondary }]} testID="room-detail-workload">
              {assignment.workload}
            </Text>
          ) : null}
          {assignment.shift ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.assignMeta, { color: theme.textMuted }]} testID="room-detail-shift">
              {assignment.shift}
            </Text>
          ) : null}
        </View>
      </View>
      {showButton ? (
        <Button
          label={t(`roomBoard.detail.action.${action.key}`)}
          onPress={onAssign}
          loading={saving}
          disabled={action.disabled}
          variant="secondary"
          size="sm"
          style={styles.assignButton}
          testID="room-detail-change-assignment"
        />
      ) : null}
      {onViewWorkload ? (
        <Button
          label={t("roomBoard.detail.viewWorkload")}
          onPress={onViewWorkload}
          variant="ghost"
          size="sm"
          style={styles.assignButton}
          icon="people-outline"
          testID="room-detail-view-workload"
        />
      ) : null}
    </View>
  );
}

export function CleaningCard({ cleaning }: { cleaning: DetailCleaning }) {
  const theme = useTheme();
  return (
    <View testID={`room-detail-cleaning-${cleaning.kind}`}>
      {cleaning.message ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>{cleaning.message}</Text>
      ) : null}
      {cleaning.rows.length > 0 ? <FactRows rows={cleaning.rows} /> : null}
    </View>
  );
}

export function NoteCard({ note, t }: { note: DetailNote; t: Translate }) {
  const theme = useTheme();
  return (
    <View testID="room-detail-note">
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textPrimary }]}>{note.text}</Text>
      {note.at ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.assignMeta, { color: theme.textMuted }]}>{t("roomBoard.detail.noteAt", { at: note.at })}</Text>
      ) : null}
    </View>
  );
}

export function WorkOrderCard({ workOrder, t }: { workOrder: DetailWorkOrder; t: Translate }) {
  const theme = useTheme();
  const meta = [
    workOrder.status ? t("roomBoard.detail.workOrder.status", { status: workOrder.status }) : null,
    workOrder.priority ? t("roomBoard.detail.workOrder.priorityLabel", { priority: workOrder.priority }) : null,
    workOrder.number ? t("roomBoard.detail.workOrder.number", { number: workOrder.number }) : null,
  ].filter((part): part is string => part !== null);
  return (
    <View style={styles.assignRow} testID="room-detail-work-order">
      <View style={[styles.assignIcon, { backgroundColor: theme.status.pickupSoft }]}>
        <Ionicons name="construct-outline" size={18} color={theme.status.pickup} />
      </View>
      <View style={styles.assignBody}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.assignName, { color: theme.textPrimary }]}>{workOrder.title}</Text>
        {meta.map((line) => (
          <Text key={line} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.assignMeta, { color: theme.textSecondary }]}>{line}</Text>
        ))}
      </View>
    </View>
  );
}

export function ExceptionBlock({ exception }: { exception: DetailException }) {
  const theme = useTheme();
  const icon = exception.key === "dnd" ? "moon-outline" : exception.key === "declined" ? "hand-left-outline" : "speedometer-outline";
  return (
    <View style={styles.assignRow} testID={`room-detail-exception-${exception.key}`}>
      <View style={[styles.assignIcon, { backgroundColor: theme.surfaceSubtle }]}>
        <Ionicons name={icon} size={18} color={theme.textSecondary} />
      </View>
      <View style={styles.assignBody}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.assignName, { color: theme.textPrimary }]}>{exception.title}</Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.assignMeta, { color: theme.textSecondary }]}>{exception.body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 6 },
  sectionTitle: { fontSize: 11, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase", marginLeft: 2 },
  card: { borderWidth: 1, borderRadius: R.lg, paddingHorizontal: 13, paddingVertical: 12, gap: 10 },

  statusBadge: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  statusBadgeText: { fontSize: 12, fontWeight: "800" },
  flag: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  flagText: { fontSize: 11.5, fontWeight: "800" },

  rows: { gap: 9 },
  row: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 14 },
  rowLabel: { flexShrink: 0, maxWidth: "42%", fontSize: 13 },
  rowValue: { flex: 1, textAlign: "right", fontSize: 13, fontWeight: "600" },

  assignRow: { flexDirection: "row", alignItems: "flex-start", gap: 11 },
  assignIcon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  assignBody: { flex: 1, minWidth: 0, gap: 2 },
  assignName: { fontSize: 15, fontWeight: "700", lineHeight: 20 },
  assignMeta: { fontSize: 12.5, lineHeight: 17 },
  assignButton: { marginTop: 10 },
  body: { fontSize: 14, lineHeight: 20 },
});
