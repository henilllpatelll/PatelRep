import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { R } from "@/components/shared/tokens";
import { Button } from "@/components/ui/Button";
import type { CompletionBlocker } from "@/lib/engineering/repairWorkspace";
import type { ChecklistLoad } from "@/lib/engineering/workOrderChecklist";

interface Props {
  blockers: readonly CompletionBlocker[];
  checklist: ChecklistLoad;
  online: boolean;
  /** Closes the sheet and opens the Checklist tab. */
  onViewChecklist: () => void;
}

/**
 * The first thing in Review Completion: what is ready and what is not. Each line is a rule the app or the API really
 * enforces, so "ready" is never a claim the server could contradict. Wording is words plus an icon, never colour alone.
 */
export function CompletionReadiness({ blockers, checklist, online, onViewChecklist }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const ready = blockers.length === 0;
  const checklistSummary = checklist.phase === "ready" && checklist.snapshot.items.length > 0 ? checklist.snapshot.summary : null;
  const checklistBlocked = blockers.some((b) => b.id === "checklist");
  // Online, an unreadable checklist does not block: say so, so the person is not surprised by the server's answer.
  const unreadOnline = online && checklist.phase === "error";

  return (
    <View
      style={[styles.card, { backgroundColor: theme.surface, borderColor: ready ? theme.border : theme.status.pickup }]}
      accessibilityLiveRegion="polite"
      testID="wo-readiness"
    >
      <View style={styles.head}>
        <Ionicons name={ready ? "checkmark-circle" : "alert-circle"} size={18} color={ready ? theme.primaryAction : theme.status.pickup} />
        <Text accessibilityRole="header" style={{ color: theme.textPrimary, fontSize: 14.5, fontWeight: "800" }}>
          {t(ready ? "workOrders.repair.complete.readiness.ready" : "workOrders.repair.complete.readiness.blocked")}
        </Text>
      </View>

      {blockers.map((blocker) => (
        <View key={blocker.id} style={styles.line} testID={`wo-blocker-${blocker.id}`}>
          <Ionicons name="ellipse" size={6} color={theme.status.pickup} style={styles.dot} />
          <Text style={{ flex: 1, color: theme.textPrimary, fontSize: 13.5, lineHeight: 19 }}>
            {t(`workOrders.repair.complete.readiness.blocker.${blocker.id}`, { count: blocker.count ?? 0 })}
          </Text>
        </View>
      ))}

      {checklistSummary ? (
        <Text style={{ color: theme.textSecondary, fontSize: 13 }} testID="wo-readiness-checklist">
          {t("workOrders.repair.complete.readiness.checklist", { done: checklistSummary.completed, total: checklistSummary.total })}
        </Text>
      ) : null}
      {unreadOnline ? (
        <Text style={{ color: theme.textMuted, fontSize: 12.5, lineHeight: 18 }} testID="wo-readiness-unread">
          {t("workOrders.repair.complete.readiness.unverifiedOnline")}
        </Text>
      ) : null}

      {checklistBlocked ? (
        <Button label={t("workOrders.repair.complete.readiness.viewChecklist")} variant="secondary" size="sm" icon="list-outline" onPress={onViewChecklist} testID="wo-readiness-view-checklist" />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: R.lg, padding: 14, gap: 8 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  line: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  dot: { marginTop: 7 },
});
