import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { useTheme } from "@/lib/theme/useTheme";
import { useV2Text } from "@/lib/design/housekeeperV2";
import { formatDuration, formatClock } from "@/lib/engineering/workOrders";
import { formatStopwatch, type LaborSession, type LaborSummary } from "@/lib/engineering/repairWorkspace";
import { monoFont } from "@/components/shared/tokens";
import { InlineError, Note, sheetStyles } from "./sheetKit";
import { useSheetSubmit } from "./useSheetSubmit";

interface Props {
  visible: boolean;
  onClose: () => void;
  online: boolean;
  locale: string;
  userId: string | null | undefined;
  sessions: readonly LaborSession[];
  summary: LaborSummary;
  canStart: boolean;
  canPause: boolean;
  startVerb: "start" | "resume";
  failedToLoad: boolean;
  onStart: () => Promise<void>;
  onPause: () => Promise<void>;
}

/**
 * Labor as the server recorded it. The running time is `now - started_at` of the server's open session; a pause
 * closes that session, so paused time is never counted. Labor needs a connection: a timer started offline would
 * be a session the server never confirmed.
 */
export function LaborSheet({ visible, onClose, online, locale, userId, sessions, summary, canStart, canPause, startVerb, failedToLoad, onStart, onPause }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const x = useV2Text();
  const { busy, error, run } = useSheetSubmit();
  const newestFirst = [...sessions].sort((a, b) => b.started_at.localeCompare(a.started_at));

  return (
    <BottomSheet visible={visible} title={t("workOrders.repair.labor.title")} onClose={onClose} tall testID="wo-labor-sheet">
      <View style={sheetStyles.stack}>
        {summary.active ? (
          <View style={{ gap: 2 }}>
            <Text style={[{ color: theme.textMuted, fontSize: 11, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase" }, x.label]}>
              {summary.activeIsMine ? t("workOrders.repair.labor.activeMine") : t("workOrders.repair.labor.activeOther")}
            </Text>
            <Text accessibilityRole="timer" style={[{ color: theme.textPrimary, fontSize: 34, fontWeight: "700", fontFamily: monoFont }, x.num]} testID="wo-labor-active">
              {formatStopwatch(summary.activeSeconds)}
            </Text>
          </View>
        ) : null}
        <Text style={{ color: theme.textSecondary, fontSize: 14 }} testID="wo-labor-total">
          {t("workOrders.repair.labor.total", { time: formatDuration(Math.round(summary.totalMinutes)) })}
        </Text>

        {canPause ? (
          <Button label={t("workOrders.repair.labor.pause")} variant="secondary" size="lg" icon="pause-outline" onPress={() => void run(onPause)} loading={busy} disabled={!online || busy} testID="wo-labor-pause" />
        ) : canStart ? (
          <Button
            label={t(startVerb === "resume" ? "workOrders.repair.labor.resume" : "workOrders.repair.labor.start")}
            size="lg"
            icon="play-outline"
            onPress={() => void run(onStart)}
            loading={busy}
            disabled={!online || busy}
            testID="wo-labor-start"
          />
        ) : null}
        {!online ? <Note>{t("workOrders.repair.labor.needsConnection")}</Note> : null}
        {error ? <InlineError>{error}</InlineError> : null}
        {failedToLoad ? <InlineError>{t("workOrders.repair.labor.loadFailed")}</InlineError> : null}

        <Text style={[{ color: theme.textMuted, fontSize: 11, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase", marginTop: 8 }, x.label]}>
          {t("workOrders.repair.labor.sessions")}
        </Text>
        {newestFirst.length === 0 ? (
          <Text style={{ color: theme.textDisabled, fontSize: 13.5 }}>{t("workOrders.repair.labor.none")}</Text>
        ) : (
          newestFirst.map((session) => (
            <View key={session.id} style={{ flexDirection: "row", justifyContent: "space-between", gap: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: theme.borderSubtle }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.textPrimary, fontSize: 14 }}>
                  {session.staff_user_id === userId ? t("workOrders.repair.labor.you") : t("workOrders.repair.labor.technician")}
                </Text>
                <Text style={[{ color: theme.textMuted, fontSize: 12.5, fontFamily: monoFont }, x.num]}>
                  {formatClock(session.started_at, locale) ?? "—"} → {session.ended_at ? formatClock(session.ended_at, locale) ?? "—" : t("workOrders.repair.labor.running")}
                </Text>
              </View>
              <Text style={[{ color: theme.textPrimary, fontSize: 14, fontWeight: "700", fontFamily: monoFont }, x.num]}>
                {session.ended_at ? formatDuration(Math.round(Number(session.duration_minutes ?? 0))) : t("workOrders.repair.labor.running")}
              </Text>
            </View>
          ))
        )}
      </View>
    </BottomSheet>
  );
}
