import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { monoFont } from "@/components/shared/tokens";
import { useTheme } from "@/lib/theme/useTheme";
import { formatHotelTime, formatShiftDate } from "@/lib/housekeeping/hotelTime";
import type { TaskActivityEvent } from "@/lib/api/tasks";
import { actorLabel, groupByDay } from "@/lib/tasks/taskDisplay";
import type { Viewer } from "@/lib/tasks/taskActions";

const MAX_FONT_SCALE = 1.5;

interface Props {
  events: TaskActivityEvent[];
  viewer: Viewer;
  zone: string | null;
  language: string;
  now: Date;
  /** Show hotel-local day headings (the full feed). Off for the short preview. */
  grouped?: boolean;
}

function EventRow({ event, viewer, zone, language }: { event: TaskActivityEvent; viewer: Viewer; zone: string | null; language: string }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const time = formatHotelTime(event.at, zone, language) ?? "";
  const actor = actorLabel(event, viewer, t);
  const isNote = event.kind === "comment";
  const isBlockerEvent = event.kind === "blocker_reported" || event.kind === "blocker_resolved";
  const what = isNote
    ? (event.text ?? "")
    : event.kind === "blocker_reported"
      ? t("tasks.hk.sheet.event.blocker_reported", { reason: t(`tasks.hk.blocker.reason.${event.reason ?? "other"}`) })
      : event.kind === "blocker_resolved"
        ? t(`tasks.hk.sheet.event.resolution.${event.resolution ?? "resolved"}`)
        : t(`tasks.hk.sheet.event.${event.kind}`);
  // The reporter's details / a supervisor's resolution note, shown under the persisted blocker event.
  const detail = isBlockerEvent ? event.text : null;
  const a11y = isNote
    ? `${time}, ${actor ? `${actor}: ` : ""}${what}`
    : `${time}, ${what}${actor ? `, ${actor}` : ""}${detail ? `. ${detail}` : ""}`;

  return (
    <View style={styles.row} accessible accessibilityLabel={a11y} testID={`activity-${event.id}`}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.time, { color: theme.textMuted }]}>
        {time}
      </Text>
      <View style={styles.main}>
        {isNote ? (
          <>
            {actor ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.actor, { color: theme.textSecondary }]}>
                {actor}
              </Text>
            ) : null}
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textPrimary }]}>
              {what}
            </Text>
          </>
        ) : (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.event, { color: theme.textPrimary }]}>
            {what}
            {actor ? <Text style={{ color: theme.textMuted }}>{` · ${actor}`}</Text> : null}
          </Text>
        )}
        {detail ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textSecondary }]}>
            {detail}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** Chronological feed. Every row is a persisted event; the component adds nothing of its own. */
export function ActivityFeed({ events, viewer, zone, language, now, grouped = false }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();

  if (!grouped) {
    return (
      <View style={styles.list}>
        {events.map((event) => (
          <EventRow key={event.id} event={event} viewer={viewer} zone={zone} language={language} />
        ))}
      </View>
    );
  }

  return (
    <View style={styles.list}>
      {groupByDay(events, now, zone).map((group) => (
        <View key={group.bucket} style={styles.group}>
          <Text
            accessibilityRole="header"
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={[styles.day, { color: theme.textMuted }]}
          >
            {group.bucket === "today"
              ? t("tasks.hk.sheet.notes.today")
              : group.bucket === "yesterday"
                ? t("tasks.hk.sheet.notes.yesterday")
                : (formatShiftDate(group.bucket, language) ?? group.bucket)}
          </Text>
          {group.events.map((event) => (
            <EventRow key={event.id} event={event} viewer={viewer} zone={zone} language={language} />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 14 },
  group: { gap: 12 },
  day: { fontSize: 11.5, fontWeight: "800", letterSpacing: 0.9, textTransform: "uppercase" },
  row: { flexDirection: "row", gap: 12 },
  time: { width: 64, fontFamily: monoFont, fontSize: 12, paddingTop: 2 },
  main: { flex: 1, minWidth: 0, gap: 2 },
  actor: { fontSize: 12.5, fontWeight: "700" },
  note: { fontSize: 14.5, lineHeight: 20 },
  event: { fontSize: 14.5, lineHeight: 20, fontWeight: "600" },
});
