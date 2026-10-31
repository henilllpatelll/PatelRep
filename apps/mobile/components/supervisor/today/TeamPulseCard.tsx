import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { Avatar } from "@/components/shared/mobileHandoff";
import { R } from "@/components/shared/tokens";
import {
  LinkAction,
  ProgressBar,
  SectionCard,
  SectionHeader,
  Skeleton,
  UnavailableBlock,
} from "@/components/supervisor/today/TodayBlocks";
import type { Derived } from "@/lib/housekeeping/supervisorSources";
import type { StaffPulseMember, TeamPulse } from "@/lib/housekeeping/supervisorTeam";
import { selectTeamPreview } from "@/lib/housekeeping/supervisorTodayView";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

export const TEAM_PREVIEW_LIMIT = 3;

interface Props {
  team: Derived<TeamPulse>;
  t: Translate;
  onOpenAssignments: () => void;
  /** Opens the Team Schedule (who works when). Omitted = no entry point is drawn. */
  onOpenSchedule?: () => void;
  /** Tapping a person opens their quick view; "Assignments" in the header is the way to the full Team screen. */
  onOpenMember: (userId: string) => void;
  onRetry: () => void;
}

/** One line about shifts: the verified count, the last known count, or an honest "unavailable". */
function shiftSummary(pulse: TeamPulse, t: Translate): string {
  if (pulse.onShift === null || pulse.roster.status === "unknown") return t("supervisorToday.team.shiftUnknown");
  return t(pulse.roster.status === "stale" ? "supervisorToday.team.onShiftStale" : "supervisorToday.team.onShift", { count: pulse.onShift });
}

/** Attendance label for a person — only when the roster was actually read. */
function availabilityLabel(member: StaffPulseMember, t: Translate): string | null {
  switch (member.availability) {
    case "on_shift":
      return t("supervisorToday.team.statusOnShift");
    case "on_break":
      return t("supervisorToday.team.statusOnBreak");
    case "ended":
      return t("supervisorToday.team.statusEnded");
    case "not_clocked_in":
      return t("supervisorToday.team.statusNotClockedIn");
    default:
      return null;
  }
}

export function TeamPulseCard({ team, t, onOpenAssignments, onOpenSchedule, onOpenMember, onRetry }: Props) {
  const theme = useTheme();
  const pulse = team.value;
  const preview = useMemo(() => (pulse ? selectTeamPreview(pulse, TEAM_PREVIEW_LIMIT) : null), [pulse]);

  let body;
  if (team.status === "loading") {
    body = (
      <View style={styles.rows} testID="today-team-loading">
        <Skeleton height={52} />
        <Skeleton height={52} />
      </View>
    );
  } else if (!pulse || !preview) {
    body = (
      <UnavailableBlock
        testID="today-team-unavailable"
        title={t("supervisorToday.team.unavailable")}
        retryLabel={t("supervisorToday.status.retry")}
        onRetry={onRetry}
      />
    );
  } else if (preview.rows.length === 0) {
    body = (
      <View style={styles.empty} testID="today-team-empty">
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.emptyTitle, { color: theme.textPrimary }]}>
          {t("supervisorToday.team.empty")}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sub, { color: theme.textSecondary }]}>
          {t("supervisorToday.team.emptyHint")}
        </Text>
      </View>
    );
  } else {
    body = (
      <View style={styles.rows}>
        {preview.rows.map((member) => {
          const load = member.load!;
          const name = member.name ?? t("supervisorToday.attention.someone");
          const status = availabilityLabel(member, t);
          const concern =
            member.concern === "shift_ended_with_open_rooms"
              ? t("supervisorToday.team.concernEnded")
              : member.concern === "over_assigned"
                ? t("supervisorToday.team.concernOver")
                : null;
          const progress = t("supervisorToday.team.progress", { done: load.done, count: load.total });
          return (
            <Pressable
              key={member.userId}
              onPress={() => onOpenMember(member.userId)}
              testID={`today-team-row-${member.userId}`}
              accessibilityRole="button"
              accessibilityLabel={[name, progress, concern ?? status].filter(Boolean).join(". ")}
              style={({ pressed }) => [styles.row, { backgroundColor: theme.surfaceMuted }, pressed && { opacity: 0.75 }]}
            >
              <Avatar name={name} size={38} />
              <View style={styles.rowBody}>
                <View style={styles.nameRow}>
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.name, { color: theme.textPrimary }]} numberOfLines={1}>
                    {name}
                  </Text>
                  {concern || status ? (
                    <Text
                      maxFontSizeMultiplier={1.2}
                      style={[styles.tag, { color: concern ? theme.status.pickup : theme.textMuted }]}
                      numberOfLines={1}
                      testID={`today-team-tag-${member.userId}`}
                    >
                      {concern ?? status}
                    </Text>
                  ) : null}
                </View>
                <ProgressBar fraction={load.total > 0 ? load.done / load.total : 0} color={theme.status.ready} height={6} />
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sub, { color: theme.textSecondary }]}>
                  {progress}
                </Text>
              </View>
            </Pressable>
          );
        })}
        {preview.hiddenCount > 0 ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.more, { color: theme.textMuted }]} testID="today-team-more">
            {t("supervisorToday.team.more", { count: preview.hiddenCount })}
          </Text>
        ) : null}
        {preview.withoutRooms ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.more, { color: theme.textMuted }]} testID="today-team-norooms">
            {t("supervisorToday.team.withoutRooms", { count: preview.withoutRooms })}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <SectionCard testID="today-team">
      <SectionHeader
        title={t("supervisorToday.team.title")}
        right={
          <View style={styles.links}>
            {onOpenSchedule ? <LinkAction label={t("supervisorToday.team.schedule")} onPress={onOpenSchedule} testID="today-team-schedule" /> : null}
            <LinkAction label={t("supervisorToday.team.manage")} onPress={onOpenAssignments} testID="today-team-manage" />
          </View>
        }
      />
      {pulse ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sub, { color: theme.textSecondary }]} testID="today-team-shift">
          {shiftSummary(pulse, t)}
        </Text>
      ) : null}
      {body}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  links: { flexDirection: "row", alignItems: "center", gap: 14 },
  rows: { gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: MIN_TARGET + 8, padding: 10, borderRadius: R.md },
  rowBody: { flex: 1, gap: 5 },
  nameRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  name: { fontSize: 15, fontWeight: "700", flexShrink: 1 },
  tag: { fontSize: 11.5, fontWeight: "700", flexShrink: 1, textAlign: "right" },
  sub: { fontSize: 13, lineHeight: 18 },
  more: { fontSize: 12.5, fontWeight: "600", paddingHorizontal: 4 },
  empty: { gap: 4, paddingVertical: 4 },
  emptyTitle: { fontSize: 15, fontWeight: "700" },
});
