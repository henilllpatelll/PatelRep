import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { SectionLabel } from "@/components/shared/mobileHandoff";
import { todaySections } from "@/lib/engineering/pmFilters";
import type { PmScheduleView } from "@/lib/engineering/pmSchedules";
import { useTheme } from "@/lib/theme/useTheme";
import { PmScheduleCard } from "./PmScheduleCard";

export interface PmListProps {
  schedules: readonly PmScheduleView[];
  language?: string;
  draftIds: ReadonlySet<string>;
  canInspect: boolean;
  onOpen: (id: string) => void;
  onInspect: (id: string) => void;
}

/** Overdue first (clearly separate from due-today), then today's work, then a short peek at what is next. */
export function PmTodayView({ schedules, ...rest }: PmListProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { overdue, dueToday, next } = todaySections(schedules);
  const card = (s: PmScheduleView) => (
    <PmScheduleCard
      key={s.id}
      schedule={s}
      language={rest.language}
      hasDraft={rest.draftIds.has(s.id)}
      canInspect={rest.canInspect}
      onOpen={() => rest.onOpen(s.id)}
      onInspect={() => rest.onInspect(s.id)}
    />
  );
  return (
    <View style={styles.stack}>
      {overdue.length > 0 ? (
        <View style={styles.section} testID="pm-today-overdue">
          <SectionLabel hint={String(overdue.length)}>{t("pmSchedules.overdue")}</SectionLabel>
          {overdue.map(card)}
        </View>
      ) : null}
      <View style={styles.section} testID="pm-today-due">
        <SectionLabel hint={String(dueToday.length)}>{t("pmSchedules.dueToday")}</SectionLabel>
        {dueToday.length > 0 ? dueToday.map(card) : <Text style={[styles.none, { color: theme.textMuted }]}>{t("pm.nothingDueToday")}</Text>}
      </View>
      {next.length > 0 ? (
        <View style={styles.section} testID="pm-today-next">
          <SectionLabel hint={String(next.length)}>{t("pm.comingUp")}</SectionLabel>
          {next.slice(0, 3).map(card)}
          {next.length > 3 ? <Text style={[styles.none, { color: theme.textMuted }]}>{t("pm.moreInWeek", { count: next.length - 3 })}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 18 },
  section: { gap: 8 },
  none: { fontSize: 13, paddingVertical: 4 },
});
