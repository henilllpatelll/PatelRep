import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { StatePill, toneOf } from "@/components/scheduling/requestParts";
import { R } from "@/components/shared/tokens";
import type { RequestItem } from "@/lib/api/schedulingRequests";
import { clockLabel, dateRangeLabel, reasonText, statusText } from "@/lib/scheduling/requestsModel";
import { formatShortDate } from "@/lib/scheduling/teamScheduleDates";
import { roleLabel, type Translate } from "@/lib/scheduling/teamScheduleText";
import { useTheme } from "@/lib/theme/useTheme";

/* One request in a list. Deliberately light: who, what, when, status, and (for a supervisor) how many scheduled shifts the
   dates touch -- a number that is shown only when the server read the schedule. Everything else is in the drawer. */

interface Props {
  item: RequestItem;
  /** "manager" shows the person who asked and the schedule effect; "self" shows what the request is about. */
  audience: "manager" | "self";
  language?: string;
  onPress: () => void;
  t: Translate;
}

export function RequestCard({ item, audience, language, onPress, t }: Props) {
  const theme = useTheme();
  const isLeave = item.type === "time_off";
  const name = item.user.name ?? t("teamSchedule.unnamed");
  const role = audience === "manager" && item.user.role ? roleLabel(item.user.role, t) : null;
  const dates = isLeave && item.leave?.partial
    ? `${formatShortDate(item.dateFrom ?? "", language)} · ${clockLabel(item.leave.startTime, language)} – ${clockLabel(item.leave.endTime, language)}`
    : dateRangeLabel(item.dateFrom, item.dateTo, language);
  const statusLabel = statusText(item.status, t);

  const impact = !isLeave || audience !== "manager" || (item.status !== "pending" && item.status !== "approved")
    ? null
    : item.shiftCount === null ? t("teamSchedule.requests.card.impactUnknown")
      : item.shiftCount === 0 ? t("teamSchedule.requests.card.impactNone") : t("teamSchedule.requests.card.impactSome", { count: item.shiftCount });

  const swapLine = !isLeave
    ? audience === "manager"
      ? `${item.user.name ?? ""} ⇄ ${item.counterpart?.name ?? ""}`
      : item.needsMyResponse ? t("scheduling.myRequests.swapAsked", { name: item.user.name ?? "—" }) : t("scheduling.myRequests.swapFrom", { name: item.counterpart?.name ?? "—" })
    : null;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${t("teamSchedule.requests.card.open", { name })}. ${statusLabel}. ${dates}`}
      testID={`request-${item.type}-${item.id}`}
      style={({ pressed }) => [styles.card, { backgroundColor: theme.surface, borderColor: item.needsAction ? theme.status.pickup : theme.borderSubtle }, pressed && { opacity: 0.85 }]}
    >
      <View style={styles.head}>
        <View style={styles.headText}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={2} style={[styles.name, { color: theme.textPrimary }]}>
            {audience === "manager" ? name : isLeave ? t("teamSchedule.requests.card.timeOff") : swapLine}
          </Text>
          {role ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textSecondary }]}>
              {role}
            </Text>
          ) : null}
        </View>
        <StatePill text={statusLabel} tone={toneOf(item.status)} testID={`request-status-${item.id}`} />
      </View>
      <View style={styles.row}>
        <Ionicons name={isLeave ? "sunny-outline" : "swap-horizontal-outline"} size={16} color={theme.textMuted} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textPrimary }]}>
          {isLeave ? t("teamSchedule.requests.card.timeOff") : t("teamSchedule.requests.card.swap")}
          {audience === "manager" && !isLeave && item.counterpart ? ` ${t("teamSchedule.requests.card.swapWith", { name: item.counterpart.name ?? "—" })}` : ""}
        </Text>
      </View>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textPrimary }]}>
        {dates}
        {isLeave && item.leave ? ` · ${reasonText(item.leave.reason, t)}` : ""}
      </Text>
      {audience === "manager" && swapLine && !isLeave ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textSecondary }]}>
          {swapLine}
        </Text>
      ) : null}
      {impact ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: item.shiftCount ? theme.status.pickup : theme.textSecondary }]} testID={`request-impact-${item.id}`}>
          {impact}
        </Text>
      ) : null}
      <View style={styles.row}>
        {item.submittedAt ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, styles.flex, { color: theme.textMuted }]}>
            {t("teamSchedule.requests.card.submitted", { date: formatShortDate(item.submittedAt.slice(0, 10), language) })}
          </Text>
        ) : <View style={styles.flex} />}
        {item.needsMyResponse ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.action, { color: theme.status.pickup }]}>
            {t("scheduling.myRequests.needsYou")}
          </Text>
        ) : item.needsAction && audience === "manager" ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.action, { color: theme.primaryAction }]}>
            {t("teamSchedule.requests.card.review")}
          </Text>
        ) : null}
        <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: R.lg, padding: 14, gap: 6 },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  headText: { flex: 1, minWidth: 0 },
  name: { fontSize: 17, fontWeight: "800" },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  flex: { flex: 1 },
  body: { fontSize: 15, lineHeight: 21 },
  muted: { fontSize: 13, lineHeight: 18 },
  action: { fontSize: 13, fontWeight: "800" },
});
