import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { useTheme } from "@/lib/theme/useTheme";
import type { RepairActions } from "@/lib/engineering/repairWorkspace";

export type BarAction = "claim" | "start" | "resumeWork" | "complete" | "pauseLabor" | "startLabor" | "hold";

interface Props {
  actions: RepairActions;
  online: boolean;
  /** Whichever mutation is running; every button is disabled while it is, so two actions cannot cross. */
  busy: string | null;
  laborRunning: boolean;
  onAction: (action: BarAction) => void;
  bottomInset: number;
}

/**
 * The sticky bar. One primary action per state; the secondary labor and hold buttons sit beside Review Completion.
 * Claim is allowed offline (it queues); everything else needs a connection and is disabled, not hidden, without one.
 */
export function WorkOrderActionBar({ actions, online, busy, laborRunning, onAction, bottomInset }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { can, primary, laborVerb } = actions;
  if (!primary) return null;
  const locked = busy != null;

  return (
    <View style={[styles.bar, { backgroundColor: theme.surface, borderTopColor: theme.border, paddingBottom: Math.max(bottomInset, 12) + 8 }]} testID="wo-action-bar">
      {primary === "claim" ? (
        <Button label={t("workOrders.repair.actions.claim")} icon="hand-right-outline" size="lg" onPress={() => onAction("claim")} loading={busy === "claim"} disabled={locked} testID="wo-claim" />
      ) : null}

      {primary === "start" ? (
        <Button label={t("workOrders.repair.actions.startRepair")} icon="play-outline" size="lg" onPress={() => onAction("start")} loading={busy === "start"} disabled={!online || locked} testID="wo-start-repair" />
      ) : null}

      {primary === "resumeWork" ? (
        <Button label={t("workOrders.repair.actions.resumeWork")} icon="play-outline" size="lg" onPress={() => onAction("resumeWork")} loading={busy === "resumeWork"} disabled={!online || locked} testID="wo-resume-work" />
      ) : null}

      {primary === "complete" ? (
        <View style={styles.row}>
          {can.pauseLabor || can.startLabor ? (
            <Button
              label={t(can.pauseLabor ? "workOrders.repair.actions.pauseLabor" : laborVerb === "resume" ? "workOrders.repair.actions.resumeLabor" : "workOrders.repair.actions.startLabor")}
              variant="secondary"
              size="lg"
              icon={laborRunning ? "pause-outline" : "play-outline"}
              onPress={() => onAction(can.pauseLabor ? "pauseLabor" : "startLabor")}
              loading={busy === "pauseLabor" || busy === "startLabor"}
              disabled={!online || locked}
              style={styles.grow}
              testID="wo-labor-toggle"
            />
          ) : null}
          <Button label={t("workOrders.repair.actions.reviewCompletion")} size="lg" icon="checkmark" onPress={() => onAction("complete")} disabled={locked} style={styles.grow} testID="wo-review-completion" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 18, paddingTop: 12, borderTopWidth: 1 },
  row: { flexDirection: "row", gap: 10 },
  grow: { flex: 1 },
});
