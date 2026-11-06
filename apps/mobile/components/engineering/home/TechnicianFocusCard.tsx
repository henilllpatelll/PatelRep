import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { CATEGORY_META } from "@/components/engineering/WorkOrderCard";
import { dueState, formatClock, formatDuration, workOrderLocation, type WorkOrder } from "@/lib/engineering/workOrders";
import type { FocusState } from "@/lib/engineering/homeFocus";
import { useTheme } from "@/lib/theme/useTheme";
import { useV2Text } from "@/lib/design/housekeeperV2";
import { HOME_MAX_FONT, useHomeStyles } from "./homeStyles";
import { createTypographyStyles } from "@/lib/design/reactiveTypography";

interface Props {
  focus: FocusState;
  locale: "en" | "es";
  now: Date;
  /** Opens the state's destination (see focusRoute in homeNavigation.ts). */
  onPrimary: () => void;
  /** Opens My Work for the other in-progress orders. */
  onMoreActive: () => void;
}

function WorkOrderFacts({ wo, locale, now, showStarted }: { wo: WorkOrder; locale: "en" | "es"; now: Date; showStarted: boolean }) {
  const homeStyles = useHomeStyles();
  const styles = useStyles();
  const x = useV2Text();
  const { t } = useTranslation();
  const theme = useTheme();
  const categoryKey = wo.category && CATEGORY_META[wo.category] ? wo.category : "general";
  const { room, text } = workOrderLocation(wo);
  const where = room ? t("home.engineer.roomLabel", { room }) : text;
  const due = dueState(wo, locale, now);
  const started = showStarted ? formatClock(wo.started_at, locale) : null;
  const heading = [wo.work_order_number, where].filter(Boolean).join(" · ");
  return (
    <>
      {heading ? (
        <Text maxFontSizeMultiplier={HOME_MAX_FONT} style={[styles.heading, { color: theme.textSecondary }]} numberOfLines={1}>
          {heading}
        </Text>
      ) : null}
      <Text maxFontSizeMultiplier={HOME_MAX_FONT} style={[styles.title, { color: theme.textPrimary }]} numberOfLines={3}>
        {wo.title}
      </Text>
      <Badges wo={wo} />
      <Text maxFontSizeMultiplier={HOME_MAX_FONT} style={[homeStyles.meta, { color: theme.textSecondary }]}>
        {t(`workOrders.category.${categoryKey}`)}
        {wo.guest_reported ? ` · ${t("workOrders.chipGuest")}` : ""}
      </Text>
      {started ? (
        <Text maxFontSizeMultiplier={HOME_MAX_FONT} style={[homeStyles.meta, { color: theme.textSecondary }]}>
          {t("home.engineer.startedAt", { time: started })}
        </Text>
      ) : null}
      {due?.kind === "overdue" ? (
        <Text maxFontSizeMultiplier={HOME_MAX_FONT} style={[homeStyles.meta, { color: theme.status.dirty, fontWeight: "700" }]}>
          {t("home.engineer.overdueBy", { duration: formatDuration(due.minutes) })}
        </Text>
      ) : due?.kind === "due" ? (
        <Text maxFontSizeMultiplier={HOME_MAX_FONT} style={[homeStyles.meta, { color: theme.textSecondary }]}>
          {t("home.engineer.dueAt", { time: due.clock })}
        </Text>
      ) : null}
    </>
  );
}

function Badges({ wo }: { wo: WorkOrder }) {
  const homeStyles = useHomeStyles();
  const { t } = useTranslation();
  return (
    <View style={homeStyles.badgeRow}>
      {wo.priority === "emergency" || wo.priority === "urgent" ? <StatusBadge statusKey="urgent" label={t(`home.engineer.priority.${wo.priority}`)} /> : null}
      <StatusBadge statusKey="pickup" label={t(`workOrders.status.${wo.status}`)} />
    </View>
  );
}

/**
 * The single contextual primary card. It only ever links: starting, claiming or completing a repair happens on the work
 * order itself, so a passive refresh of Home can never change a work order.
 */
export function TechnicianFocusCard({ focus, locale, now, onPrimary, onMoreActive }: Props) {
  const homeStyles = useHomeStyles();
  const styles = useStyles();
  const { t } = useTranslation();
  const theme = useTheme();
  const x = useV2Text();

  switch (focus.kind) {
    case "none":
      return null;

    case "continue_repair":
    case "start_next": {
      const continuing = focus.kind === "continue_repair";
      const label = t(continuing ? "home.engineer.continueRepair" : "home.engineer.startNextAction");
      return (
        <Card style={styles.card} testID="engineer-focus">
          <Text maxFontSizeMultiplier={HOME_MAX_FONT} accessibilityRole="header" style={[styles.kicker, x.label, { color: theme.primary }]}>
            {t(continuing ? "home.engineer.continueKicker" : "home.engineer.startNextKicker")}
          </Text>
          <WorkOrderFacts wo={focus.wo} locale={locale} now={now} showStarted={continuing} />
          <Button label={label} icon={continuing ? "construct-outline" : "arrow-forward-outline"} onPress={onPrimary} accessibilityLabel={`${label}: ${focus.wo.title}`} testID={continuing ? "engineer-continue" : "engineer-start-next"} />
          {continuing && focus.moreActive > 0 ? (
            <Pressable onPress={onMoreActive} accessibilityRole="button" style={homeStyles.linkRow} testID="engineer-more-active">
              <Text maxFontSizeMultiplier={HOME_MAX_FONT} style={[homeStyles.link, { color: theme.primaryAction }]}>
                {t("home.engineer.moreActive", { count: focus.moreActive })}
              </Text>
            </Pressable>
          ) : null}
          {!continuing && focus.queued > 1 ? (
            <Text maxFontSizeMultiplier={HOME_MAX_FONT} style={[homeStyles.meta, { color: theme.textMuted }]} testID="engineer-start-next-more">
              {t("home.engineer.startNextMore", { count: focus.queued - 1 })}
            </Text>
          ) : null}
        </Card>
      );
    }

    case "resume_pm": {
      const { draft, schedule } = focus.pm;
      const name = schedule?.name ?? draft.label ?? t("home.engineer.resumePmFallback");
      const where = schedule?.assetName ?? null;
      return (
        <Card style={styles.card} testID="engineer-focus-pm">
          <Text maxFontSizeMultiplier={HOME_MAX_FONT} accessibilityRole="header" style={[styles.kicker, x.label, { color: theme.primary }]}>
            {t("home.engineer.resumePmKicker")}
          </Text>
          {where ? (
            <Text maxFontSizeMultiplier={HOME_MAX_FONT} style={[styles.heading, { color: theme.textSecondary }]} numberOfLines={1}>
              {where}
            </Text>
          ) : null}
          <Text maxFontSizeMultiplier={HOME_MAX_FONT} style={[styles.title, { color: theme.textPrimary }]} numberOfLines={3}>
            {name}
          </Text>
          <Text maxFontSizeMultiplier={HOME_MAX_FONT} style={[homeStyles.meta, { color: theme.textSecondary }]}>
            {t("home.engineer.resumePmProgress", { answered: draft.answered, total: draft.total })}
          </Text>
          <Text maxFontSizeMultiplier={HOME_MAX_FONT} style={[homeStyles.meta, { color: theme.textMuted }]}>
            {t("home.engineer.resumePmLocal")}
          </Text>
          <Button label={t("home.engineer.resumePmAction")} icon="clipboard-outline" onPress={onPrimary} accessibilityLabel={`${t("home.engineer.resumePmAction")}: ${name}`} testID="engineer-resume-pm" />
        </Card>
      );
    }

    case "available_work":
      return (
        <Card style={styles.card} testID="engineer-focus-available">
          <Text maxFontSizeMultiplier={HOME_MAX_FONT} accessibilityRole="header" style={[styles.kicker, x.label, { color: theme.primary }]}>
            {t("home.engineer.availableKicker")}
          </Text>
          <Text maxFontSizeMultiplier={HOME_MAX_FONT} style={[styles.title, { color: theme.textPrimary }]}>
            {t("home.engineer.availableTitle", { count: focus.count })}
          </Text>
          <Text maxFontSizeMultiplier={HOME_MAX_FONT} style={[homeStyles.meta, { color: theme.textSecondary }]}>
            {t("home.engineer.availableHint")}
          </Text>
          <Button label={t("home.engineer.viewAvailable")} icon="list-outline" variant="secondary" onPress={onPrimary} testID="engineer-view-available" />
        </Card>
      );

    case "caught_up":
    case "caught_up_pm_unknown":
      return (
        <Card style={[styles.card, styles.row]} testID="engineer-caught-up">
          <Ionicons name="checkmark-done-outline" size={22} color={theme.status.ready} />
          <Text maxFontSizeMultiplier={HOME_MAX_FONT} style={[styles.caughtUp, { color: theme.textPrimary }]}>
            {t(focus.kind === "caught_up" ? "home.engineer.caughtUp" : "home.engineer.caughtUpPmUnknown")}
          </Text>
        </Card>
      );
  }
}

const useStyles = createTypographyStyles((t) => ({
  card: { gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  kicker: { fontSize: 10.5, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" },
  heading: { fontSize: 12.5, fontWeight: "700", fontFamily: t.mono },
  title: { fontSize: 19, fontWeight: "700", lineHeight: 25 },
  caughtUp: { flex: 1, fontSize: 15, fontWeight: "600", lineHeight: 21 },
}));
