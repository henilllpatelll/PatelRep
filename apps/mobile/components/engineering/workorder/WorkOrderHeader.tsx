import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/lib/theme/useTheme";
import { R, monoFont } from "@/components/shared/tokens";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { dueState, formatDuration, workOrderLocation, type WorkOrder } from "@/lib/engineering/workOrders";
import { workOrderLabel } from "@/lib/engineering/workQueue";
import { formatStopwatch, type LaborSummary } from "@/lib/engineering/repairWorkspace";

interface HeaderProps {
  wo: WorkOrder;
  onBack: () => void;
  onMore: (() => void) | null;
}

/** Dark branded header: back, work-order number, status and priority at a glance, and the More menu. */
export function WorkOrderHeader({ wo, onBack, onMore }: HeaderProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const label = workOrderLabel(wo) ?? t("workOrders.detailKicker");
  const priority = wo.priority === "emergency" || wo.priority === "urgent" ? t(`workOrders.repair.priority.${wo.priority}`) : null;
  const status = t(`workOrders.status.${wo.status}`);
  const statusLine = [priority, status].filter(Boolean).join(" · ").toUpperCase();
  const { room, text: locationText } = workOrderLocation(wo);
  const where = room ? `${t("workOrders.repair.complete.room", { room })}${wo.rooms?.floor != null ? `  ·  ${t("workOrders.floor", { floor: wo.rooms.floor })}` : ""}` : locationText;
  const chips = [wo.guest_reported ? t("workOrders.chipGuest") : null].filter(Boolean) as string[];

  return (
    <View style={[styles.hero, { paddingTop: insets.top + 8, backgroundColor: theme.shell.bg }]}>
      <View style={styles.nav}>
        <Pressable onPress={onBack} style={styles.icon} accessibilityRole="button" accessibilityLabel={t("common.back")} testID="wo-back">
          <Ionicons name="arrow-back" size={22} color={theme.shell.ink} />
        </Pressable>
        <View style={styles.body}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.number, { color: theme.shell.ink, fontFamily: monoFont }]} accessibilityRole="header" testID="wo-number">
            {label}
          </Text>
          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={[styles.statusLine, { color: wo.priority === "emergency" || wo.priority === "urgent" ? theme.status.dirty : theme.shell.ink3 }]}
            accessibilityLabel={`${priority ? `${priority}. ` : ""}${status}`}
            testID="wo-status-line"
          >
            {statusLine}
          </Text>
        </View>
        {onMore ? (
          <Pressable onPress={onMore} style={styles.icon} accessibilityRole="button" accessibilityLabel={t("workOrders.repair.more.title")} testID="wo-more">
            <Ionicons name="ellipsis-horizontal" size={22} color={theme.shell.ink} />
          </Pressable>
        ) : (
          <View style={styles.icon} />
        )}
      </View>
      {where ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={1} style={[styles.where, { color: theme.shell.ink3 }]} testID="wo-where">
          {where}
        </Text>
      ) : null}
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={3} style={[styles.title, { color: theme.shell.ink }]} testID="wo-title">
        {wo.title}
      </Text>
      {chips.length > 0 ? (
        <View style={styles.chips}>
          {chips.map((chip) => (
            <Text key={chip} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.chip, { color: theme.shell.ink, borderColor: theme.shell.ink3 }]} testID="wo-chip-guest">
              {chip}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

interface SummaryProps {
  wo: WorkOrder;
  locale: string;
  labor: LaborSummary;
  laborFailed: boolean;
  nowMs: number;
  onOpenLabor: () => void;
}

/** Two compact facts: when it is due, and the labor the server has recorded. Nothing is inferred from the order's age. */
export function WorkOrderSummary({ wo, locale, labor, laborFailed, nowMs, onOpenLabor }: SummaryProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const due = dueState(wo, locale, new Date(nowMs));
  const dueText =
    due?.kind === "overdue" ? t("workOrders.overdueBy", { time: formatDuration(due.minutes) }) : due?.kind === "due" ? due.clock : wo.due_at ? "—" : t("workOrders.repair.summary.noDeadline");
  const overdue = due?.kind === "overdue";

  const running = labor.active != null;
  const laborText = laborFailed
    ? "—"
    : running
      ? formatStopwatch(labor.activeSeconds)
      : labor.recordedMinutes > 0
        ? formatDuration(Math.round(labor.recordedMinutes))
        : t("workOrders.repair.summary.noLabor");

  return (
    <View style={styles.summary} testID="wo-summary">
      {wo.status !== "completed" && wo.status !== "cancelled" ? (
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: overdue ? theme.status.dirtyLine : theme.border }]} accessible accessibilityLabel={`${t("workOrders.factDue")}: ${dueText}`}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.cardLabel, { color: theme.textMuted }]}>{t("workOrders.factDue")}</Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.cardValue, { color: overdue ? theme.status.dirty : theme.textPrimary }]} testID="wo-due">{dueText}</Text>
        </View>
      ) : null}
      <Pressable
        onPress={onOpenLabor}
        style={[styles.card, { backgroundColor: theme.surface, borderColor: running ? theme.primaryLine : theme.border }]}
        accessibilityRole="button"
        accessibilityLabel={`${t("workOrders.repair.summary.labor")}: ${laborText}`}
        testID="wo-labor-card"
      >
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.cardLabel, { color: theme.textMuted }]}>
          {t(running ? "workOrders.repair.summary.laborRunning" : "workOrders.repair.summary.labor")}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.cardValue, { color: running ? theme.primaryAction : theme.textPrimary, fontFamily: monoFont }]} testID="wo-labor-value">{laborText}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { paddingHorizontal: 14, paddingBottom: 14, borderBottomLeftRadius: 22, borderBottomRightRadius: 22 },
  nav: { flexDirection: "row", alignItems: "center", gap: 8 },
  icon: { minWidth: 44, minHeight: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  body: { flex: 1 },
  number: { fontSize: 17, fontWeight: "800" },
  statusLine: { fontSize: 11, fontWeight: "800", letterSpacing: 0.8, marginTop: 1 },
  where: { fontSize: 13, fontWeight: "700", marginTop: 6, paddingHorizontal: 4 },
  title: { fontSize: 21, fontWeight: "600", lineHeight: 27, marginTop: 4, paddingHorizontal: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8, paddingHorizontal: 4 },
  chip: { fontSize: 11, fontWeight: "700", borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, overflow: "hidden" },
  summary: { flexDirection: "row", gap: 10 },
  card: { flex: 1, borderWidth: 1, borderRadius: R.lg, paddingVertical: 12, paddingHorizontal: 14, gap: 3, minHeight: 64, justifyContent: "center" },
  cardLabel: { fontSize: 10.5, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase" },
  cardValue: { fontSize: 16, fontWeight: "700" },
});
