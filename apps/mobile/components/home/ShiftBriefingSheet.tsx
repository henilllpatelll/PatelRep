import { StyleSheet, Text, View } from "react-native";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { SheetActionRow, SheetNotice, SheetSection } from "@/components/home/sheetParts";
import type { ShiftBriefing } from "@/lib/ai/briefing";
import type { BriefingPlanEntry } from "@/lib/housekeeping/homeBriefing";
import { formatClock, type TextContext, type Translate } from "@/lib/housekeeping/myRoomsText";
import type { AiRequestStatus } from "@/lib/housekeeping/useShiftBriefing";
import { useTheme } from "@/lib/theme/useTheme";

interface Props {
  visible: boolean;
  /** The deterministic plan from the shared model: the only source of what to do and in what order. */
  plan: BriefingPlanEntry[];
  /** The headline and watch-outs to show, already reconciled with the plan. `source` says who wrote them. */
  briefing: ShiftBriefing;
  status: AiRequestStatus;
  online: boolean;
  t: Translate;
  ctx: TextContext;
  onNewBriefing: () => void;
  onAskAi: () => void;
  onOpenRoom: (roomId: string) => void;
  onClose: () => void;
}

/**
 * A short, optional plan for the shift. The order and the reason for each room
 * come from the same model as Home; the AI may add its own wording above them
 * when it agrees, and the source is always labelled. A request is made only
 * when the person asks, and the sheet is complete without it.
 */
export function ShiftBriefingSheet({ visible, plan, briefing, status, online, t, ctx, onNewBriefing, onAskAi, onOpenRoom, onClose }: Props) {
  const theme = useTheme();
  const isAi = briefing.source === "ai";
  const loading = status === "loading";

  return (
    <BottomSheet
      visible={visible}
      title={t("home.briefingSheet.title")}
      onClose={onClose}
      grabber
      testID="briefing-sheet"
      footer={
        <>
          <Button
            label={t("home.briefingSheet.newBriefing")}
            icon="sparkles"
            onPress={onNewBriefing}
            loading={loading}
            disabled={loading || !online || plan.length === 0}
            testID="briefing-new"
          />
          <Button label={t("home.askAI")} onPress={onAskAi} variant="secondary" testID="briefing-ask-ai" />
        </>
      }
    >
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.source, { color: theme.textMuted }]} testID="briefing-source">
        {t(isAi ? "home.briefingSheet.sourceAi" : "home.briefingSheet.sourceLocal")}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.headline, { color: theme.textPrimary }]} testID="briefing-headline">
        {briefing.headline}
      </Text>

      {status === "offline" || (!online && !isAi) ? <SheetNotice text={t("home.briefingSheet.offline")} testID="briefing-offline" /> : null}
      {status === "unavailable" ? <SheetNotice tone="warn" text={t("home.briefingSheet.unavailable")} testID="briefing-unavailable" /> : null}

      {plan.length > 0 ? (
        <SheetSection title={t("home.briefingSheet.planTitle")} hint={t("home.briefingSheet.planHint", { minutes: briefing.estimatedMinutes })}>
          {plan.map((entry, index) => (
            <SheetActionRow
              key={entry.roomId}
              icon="bed-outline"
              title={`${index + 1}. ${t("rooms.dash.card.room", { room: entry.roomNumber })}`}
              hint={reasonLine(entry, t, ctx)}
              onPress={() => onOpenRoom(entry.roomId)}
              testID={`briefing-plan-${entry.roomNumber}`}
            />
          ))}
        </SheetSection>
      ) : (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]} testID="briefing-empty">
          {t("home.briefingSheet.emptyPlan")}
        </Text>
      )}

      {briefing.watchouts.length > 0 ? (
        <SheetSection title={t("home.briefingSheet.watchTitle")}>
          {briefing.watchouts.map((line) => (
            <View key={line} style={styles.watch}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textPrimary }]}>
                {`• ${line}`}
              </Text>
            </View>
          ))}
        </SheetSection>
      ) : null}
    </BottomSheet>
  );
}

function reasonLine(entry: BriefingPlanEntry, t: Translate, ctx: TextContext): string {
  switch (entry.reason) {
    case "active":
      return t("home.briefingSheet.reasons.active");
    case "rush":
      return t("home.briefingSheet.reasons.rush");
    case "reclean":
      return t("home.briefingSheet.reasons.reclean");
    case "arrival": {
      const time = formatClock(entry.arrivalAt, ctx);
      return time ? t("home.briefingSheet.reasons.arrivalAt", { time }) : t("home.briefingSheet.reasons.arrival");
    }
    default:
      return t("home.briefingSheet.reasons.queue");
  }
}

const styles = StyleSheet.create({
  source: { fontSize: 11, fontWeight: "800", letterSpacing: 0.9, textTransform: "uppercase" },
  headline: { fontSize: 20, fontWeight: "800", lineHeight: 26 },
  body: { fontSize: 14, lineHeight: 20 },
  watch: { paddingVertical: 2 },
});
