import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { ProgressBar } from "@/components/shared/evening";
import { R } from "@/components/shared/tokens";
import { EmptyAction } from "@/components/supervisor/board/BoardStates";
import { StateBlock } from "@/components/ui/StateBlock";
import type { TeamChip } from "@/lib/housekeeping/assignmentTeamQuery";
import type { AttendanceBadge, CapacityLine, TeamEmptyKind, TeamNote, TeamNotice } from "@/lib/housekeeping/assignmentTeamView";
import { NONE_KEY } from "@/lib/housekeeping/roomBoardFilters";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Tone → colour. Always paired with an icon and a word, so colour is never the only signal. */
export function useToneColor() {
  const theme = useTheme();
  return (tone: AttendanceBadge["tone"]): string =>
    tone === "ok" ? theme.status.ready : tone === "break" ? theme.status.pickup : tone === "unknown" ? theme.textMuted : theme.textSecondary;
}

export function AttendanceChip({ badge, testID }: { badge: AttendanceBadge; testID?: string }) {
  const color = useToneColor()(badge.tone);
  return (
    <View style={styles.attendance} testID={testID}>
      <Ionicons name={badge.icon as never} size={13} color={color} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.attendanceText, { color }]} numberOfLines={1}>
        {badge.label}
      </Text>
    </View>
  );
}

/** The capacity bar and its words. A bar is drawn only for a reliable percentage; otherwise just the reason. */
export function CapacityMeter({ capacity, testID }: { capacity: CapacityLine; testID: string }) {
  const theme = useTheme();
  const over = capacity.state === "over";
  const color = over ? theme.status.dirty : capacity.state === "at" || capacity.state === "on" ? theme.status.pickup : theme.status.ready;
  return (
    <View style={styles.capacity} testID={testID} accessible accessibilityLabel={[capacity.text, capacity.qualifier].filter(Boolean).join(", ")}>
      {capacity.percent !== null ? <ProgressBar value={capacity.fill * 100} total={100} color={color} /> : null}
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.capacityText, { color: capacity.percent !== null ? theme.textSecondary : theme.textMuted }]}>
        {capacity.text}
        {capacity.qualifier ? ` · ${capacity.qualifier}` : ""}
      </Text>
    </View>
  );
}

export function NoteLine({ note, testID }: { note: TeamNote; testID?: string }) {
  const theme = useTheme();
  const warn = note.tone === "warn";
  return (
    <View style={styles.note} testID={testID}>
      <Ionicons name={warn ? "alert-circle" : "information-circle-outline"} size={14} color={warn ? theme.status.dirty : theme.textSecondary} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.noteText, { color: warn ? theme.textPrimary : theme.textSecondary }]}>
        {note.text}
      </Text>
    </View>
  );
}

/** What the supervisor must know about how far this list can be trusted. People and rooms stay on screen. */
export function TeamNotices({ notices, onRetry, t }: { notices: TeamNotice[]; onRetry: () => void; t: Translate }) {
  const theme = useTheme();
  if (notices.length === 0) return null;
  return (
    <View style={styles.notices} testID="assignments-team-notices">
      {notices.map((notice) => (
        <View key={notice.key} style={[styles.notice, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]} accessibilityRole="alert" testID={`assignments-team-notice-${notice.key}`}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.noticeText, { color: theme.textSecondary }]}>
            {t(`assignments.v2.team.notice.${notice.key}`)}
          </Text>
          {notice.retry ? (
            <Pressable onPress={onRetry} accessibilityRole="button" accessibilityLabel={t("assignments.v2.state.retry")} style={styles.noticeRetry} testID={`assignments-team-retry-${notice.key}`}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.noticeRetryText, { color: theme.primaryAction }]}>
                {t("assignments.v2.state.retry")}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ))}
    </View>
  );
}

export function teamChipLabel(chip: TeamChip, t: Translate): string {
  switch (chip.kind) {
    case "attendance":
      return t(`assignments.v2.team.filters.attendance.${chip.value}`);
    case "workload":
      return t(`assignments.v2.team.filters.workload.${chip.value}`);
    case "building":
      return chip.building === NONE_KEY ? t("roomBoard.buildingNone") : t("roomBoard.building", { building: chip.building });
    case "floor": {
      const level = chip.floor === null ? t("roomBoard.floorUnknown") : t("roomBoard.floor", { floor: chip.floor });
      return chip.building ? t("roomBoard.filters.chipFloor", { where: t("roomBoard.building", { building: chip.building }), level }) : level;
    }
  }
}

/** Result count (a polite live region), the sort actually applied, and a removable chip per applied filter. */
export function TeamActiveFilters({
  chips,
  shown,
  total,
  sortLabel,
  onRemove,
  onClearAll,
  onEdit,
  t,
}: {
  chips: TeamChip[];
  shown: number;
  total: number;
  sortLabel: string | null;
  onRemove: (chip: TeamChip) => void;
  onClearAll: () => void;
  onEdit: () => void;
  t: Translate;
}) {
  const theme = useTheme();
  return (
    <View style={styles.activeWrap} testID="assignments-team-active-filters">
      <View style={styles.activeTop}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.activeCount, { color: theme.textSecondary }]} accessibilityLiveRegion="polite" testID="assignments-team-result-count">
          {t("assignments.v2.team.showing", { shown, total })}
        </Text>
        <View style={styles.activeActions}>
          <Pressable onPress={onEdit} accessibilityRole="button" accessibilityLabel={t("assignments.v2.filters.edit")} style={styles.action} testID="assignments-team-edit-filters">
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.actionText, { color: theme.primaryAction }]}>
              {t("assignments.v2.filters.edit")}
            </Text>
          </Pressable>
          <Pressable onPress={onClearAll} accessibilityRole="button" accessibilityLabel={t("assignments.v2.filters.clearAll")} style={styles.action} testID="assignments-team-clear-filters">
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.actionText, { color: theme.primaryAction }]}>
              {t("assignments.v2.filters.clearAll")}
            </Text>
          </Pressable>
        </View>
      </View>
      {chips.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow} keyboardShouldPersistTaps="handled">
          {chips.map((chip) => {
            const label = teamChipLabel(chip, t);
            return (
              <Pressable
                key={chip.id}
                onPress={() => onRemove(chip)}
                accessibilityRole="button"
                accessibilityLabel={t("assignments.v2.filters.removeChip", { label })}
                testID={`assignments-team-chip-${chip.id}`}
                style={({ pressed }) => [styles.activeChip, { backgroundColor: theme.surface, borderColor: theme.primaryLine }, pressed && { opacity: 0.8 }]}
              >
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.activeChipText, { color: theme.textPrimary }]}>
                  {label}
                </Text>
                <Ionicons name="close" size={16} color={theme.textMuted} />
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
      {sortLabel ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sortNote, { color: theme.textMuted }]} testID="assignments-team-sort-label">
          {t("assignments.v2.results.sortedBy", { sort: sortLabel })}
        </Text>
      ) : null}
    </View>
  );
}

/** Every reason the Team tab can have nothing to list, each with its own words and way out. */
export function TeamEmpty({
  kind,
  t,
  searchText,
  unavailableKey,
  offline,
  onRefresh,
  onClearSearch,
  onClearFilters,
}: {
  kind: TeamEmptyKind;
  t: Translate;
  searchText: string;
  unavailableKey: string | null;
  offline: boolean;
  onRefresh: () => void;
  onClearSearch: () => void;
  onClearFilters: () => void;
}) {
  switch (kind) {
    case "unavailable":
      return (
        <View testID="assignments-team-unavailable">
          <StateBlock
            status="error"
            errorIcon={offline ? "cloud-offline-outline" : "alert-circle-outline"}
            errorMessage={t(unavailableKey ?? "assignments.v2.state.unavailableError")}
            onRetry={onRefresh}
            retryLabel={t("assignments.v2.state.retry")}
          />
        </View>
      );
    case "staffListUnavailable":
      return (
        <View testID="assignments-team-staff-unavailable">
          <StateBlock status="error" errorIcon="people-outline" errorMessage={t("assignments.v2.team.empty.staffListUnavailable")} onRetry={onRefresh} retryLabel={t("assignments.v2.state.retry")} />
        </View>
      );
    case "noStaff":
      return (
        <View testID="assignments-team-empty">
          <StateBlock status="empty" emptyIcon="people-outline" emptyTitle={t("assignments.v2.team.empty.noStaff")} emptyBody={t("assignments.v2.team.empty.noStaffBody")} />
        </View>
      );
    case "search":
      return (
        <View testID="assignments-team-no-match">
          <StateBlock status="empty" emptyIcon="search-outline" emptyTitle={t("assignments.v2.team.empty.search", { query: searchText })} />
          <EmptyAction label={t("assignments.v2.search.clear")} onPress={onClearSearch} testID="assignments-team-clear-search" />
        </View>
      );
    case "filters":
      return (
        <View testID="assignments-team-no-match">
          <StateBlock status="empty" emptyIcon="funnel-outline" emptyTitle={t("assignments.v2.team.empty.filters")} />
          <EmptyAction label={t("assignments.v2.filters.clearAll")} onPress={onClearFilters} testID="assignments-team-clear-all" />
        </View>
      );
  }
}

const styles = StyleSheet.create({
  attendance: { flexDirection: "row", alignItems: "center", gap: 5 },
  attendanceText: { fontSize: 13, fontWeight: "700" },
  capacity: { gap: 5 },
  capacityText: { fontSize: 12.5, fontWeight: "600" },
  note: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  noteText: { flex: 1, fontSize: 12.5, lineHeight: 17, fontWeight: "600" },
  notices: { paddingHorizontal: 16, gap: 8, marginBottom: 8 },
  notice: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderWidth: 1, borderRadius: R.md },
  noticeText: { flex: 1, fontSize: 13, lineHeight: 18 },
  noticeRetry: { minHeight: MIN_TARGET - 8, minWidth: 56, justifyContent: "center", alignItems: "center", paddingHorizontal: 6 },
  noticeRetryText: { fontSize: 14, fontWeight: "800" },
  activeWrap: { paddingHorizontal: 16, paddingTop: 4, gap: 8 },
  activeTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" },
  activeCount: { flexShrink: 1, fontSize: 13, fontWeight: "700" },
  activeActions: { flexDirection: "row", alignItems: "center", gap: 4 },
  action: { minHeight: 44, paddingHorizontal: 8, justifyContent: "center" },
  actionText: { fontSize: 14, fontWeight: "700" },
  chipRow: { gap: 8, paddingRight: 16 },
  activeChip: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, paddingLeft: 14, paddingRight: 10, borderWidth: 1, borderRadius: 999 },
  activeChipText: { fontSize: 13.5, fontWeight: "700" },
  sortNote: { fontSize: 12.5, lineHeight: 17 },
});
