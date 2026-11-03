import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/Card";
import { SectionLabel } from "@/components/shared/mobileHandoff";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { todayPlan } from "@/lib/engineering/pmFilters";
import type { PmDraftSummary } from "@/lib/engineering/pmDraftStore";
import type { PmScheduleView } from "@/lib/engineering/pmSchedules";
import { useTheme } from "@/lib/theme/useTheme";
import { PmScheduleCard } from "./PmScheduleCard";
import { dueLabel, locationLabel, Meta, useDueTone } from "./pmUi";

export interface PmListProps {
  schedules: readonly PmScheduleView[];
  language?: string;
  draftIds: ReadonlySet<string>;
  canInspect: boolean;
  onOpen: (id: string) => void;
  onInspect: (id: string) => void;
}

interface TodayProps extends PmListProps {
  drafts: ReadonlyMap<string, PmDraftSummary>;
  /** Opens the Plan view (Week). */
  onOpenPlan: () => void;
}

const PREVIEW = 3;

/** A saved, unfinished inspection. It is a local draft, never a recorded inspection. */
function ContinueCard({ schedule, draft, language, canInspect, onOpen, onInspect }: { schedule: PmScheduleView; draft: PmDraftSummary | undefined; language?: string; canInspect: boolean; onOpen: () => void; onInspect: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const tone = useDueTone(schedule.state);
  const place = [schedule.assetName ?? t("pmSchedules.unknownAsset"), locationLabel(schedule, t)].filter(Boolean).join(" · ");
  const progress = draft && draft.total > 0 ? t("pm.today.progress", { done: draft.answered, total: draft.total }) : null;
  const fraction = draft && draft.total > 0 ? Math.min(1, draft.answered / draft.total) : 0;
  return (
    <Card style={styles.continueCard} testID={`pm-continue-${schedule.id}`}>
      <Pressable
        onPress={canInspect ? onInspect : onOpen}
        style={({ pressed }) => [styles.continueBody, { opacity: pressed ? 0.85 : 1 }]}
        accessibilityRole="button"
        accessibilityLabel={`${t("pm.continueInspection")}: ${schedule.name}, ${place}${progress ? `, ${progress}` : ""}`}
        testID={`pm-continue-open-${schedule.id}`}
      >
        <View style={styles.continueTitleRow}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.textPrimary }]} numberOfLines={2}>
            {schedule.name || t("pmSchedules.title")}
          </Text>
          <Ionicons name="chevron-forward" size={18} color={theme.textDisabled} />
        </View>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.place, { color: theme.textSecondary }]} numberOfLines={1}>
          {place}
        </Text>
        <View style={[styles.track, { backgroundColor: theme.surfaceSubtle }]} accessible={false}>
          <View style={[styles.fill, { backgroundColor: theme.status.pickup, width: `${Math.round(fraction * 100)}%` }]} />
        </View>
        <View style={styles.metaRow}>
          <Meta icon="create-outline" text={progress ?? t("pm.localDraft")} color={theme.status.pickup} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.dueText, { color: tone.fg }]}>
            {dueLabel(schedule, t, language)}
          </Text>
        </View>
      </Pressable>
    </Card>
  );
}

/**
 * Today worklist: Continue Inspection (real saved drafts only), Needs Attention (overdue, most overdue first),
 * Due Today, Coming Up. A schedule shows in one section only.
 */
export function PmTodayView({ schedules, drafts, onOpenPlan, ...rest }: TodayProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const plan = todayPlan(schedules, rest.draftIds);
  const card = (s: PmScheduleView) => (
    <PmScheduleCard
      key={s.id}
      schedule={s}
      language={rest.language}
      hasDraft={false}
      canInspect={rest.canInspect}
      onOpen={() => rest.onOpen(s.id)}
      onInspect={() => rest.onInspect(s.id)}
    />
  );
  const empty = plan.continueWork.length + plan.needsAttention.length + plan.dueToday.length === 0;
  return (
    <View style={styles.stack}>
      {plan.continueWork.length > 0 ? (
        <View style={styles.section} testID="pm-today-continue">
          <SectionLabel hint={String(plan.continueWork.length)}>{t("pm.today.continue")}</SectionLabel>
          {plan.continueWork.map((s) => (
            <ContinueCard
              key={s.id}
              schedule={s}
              draft={drafts.get(s.id)}
              language={rest.language}
              canInspect={rest.canInspect}
              onOpen={() => rest.onOpen(s.id)}
              onInspect={() => rest.onInspect(s.id)}
            />
          ))}
        </View>
      ) : null}
      {plan.needsAttention.length > 0 ? (
        <View style={styles.section} testID="pm-today-overdue">
          <SectionLabel hint={String(plan.needsAttention.length)}>{t("pm.today.needsAttention")}</SectionLabel>
          {plan.needsAttention.map(card)}
        </View>
      ) : null}
      <View style={styles.section} testID="pm-today-due">
        <SectionLabel hint={String(plan.dueToday.length)}>{t("pmSchedules.dueToday")}</SectionLabel>
        {plan.dueToday.length > 0 ? plan.dueToday.map(card) : <Text style={[styles.none, { color: theme.textMuted }]}>{empty ? t("pm.nothingDueToday") : t("pm.today.nothingElseToday")}</Text>}
      </View>
      {plan.comingUp.length > 0 ? (
        <View style={styles.section} testID="pm-today-next">
          <SectionLabel hint={String(plan.comingUp.length)}>{t("pm.comingUp")}</SectionLabel>
          {plan.comingUp.slice(0, PREVIEW).map(card)}
          <Pressable onPress={onOpenPlan} style={styles.planLink} accessibilityRole="button" testID="pm-today-open-plan">
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.planLinkText, { color: theme.primaryAction }]}>
              {plan.comingUp.length > PREVIEW ? t("pm.today.viewPlanMore", { count: plan.comingUp.length - PREVIEW }) : t("pm.today.viewPlan")}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={theme.primaryAction} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 18 },
  section: { gap: 8 },
  none: { fontSize: 13, paddingVertical: 4 },
  continueCard: { padding: 14 },
  continueBody: { gap: 8 },
  continueTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, fontSize: 15, fontWeight: "700" },
  place: { fontSize: 13 },
  track: { height: 6, borderRadius: 3, overflow: "hidden" },
  fill: { height: 6, borderRadius: 3 },
  metaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" },
  dueText: { fontSize: 12, fontWeight: "700" },
  planLink: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 44 },
  planLinkText: { fontSize: 14, fontWeight: "700" },
});
