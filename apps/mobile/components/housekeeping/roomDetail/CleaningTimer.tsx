import { useEffect, useState } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { monoFont } from "@/components/shared/tokens";
import { useTheme } from "@/lib/theme/useTheme";
import { elapsedSeconds, formatElapsed, standardMinutes } from "@/lib/housekeeping/cleaningTimer";
import { MAX_FONT_SCALE } from "./BottomSheet";

interface Props {
  /** The session's start (the server's once it has the session). */
  startedAt: string | null | undefined;
  baseMinutes?: number | null;
}

/** Lightweight foreground tick. The value is always recomputed from the start time. */
function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    // Timers pause in the background; catch up the moment the app returns.
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") setNow(Date.now());
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [intervalMs]);
  return now;
}

/**
 * Time on the room next to the standard time. The standard is an estimate for
 * orientation, not a deadline, so nothing here changes color or warns when it is
 * passed — and nothing about the timer is ever sent to the server.
 */
export function CleaningTimer({ startedAt, baseMinutes }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const now = useNow();
  const seconds = elapsedSeconds(startedAt, now);
  const standard = standardMinutes(baseMinutes);

  return (
    <View style={[styles.root, { backgroundColor: theme.surface, borderColor: theme.border }]} testID="cleaning-timer">
      <View
        style={styles.block}
        accessible
        accessibilityRole="timer"
        accessibilityLabel={
          seconds === null
            ? t("rooms.work.timer.unknownA11y")
            : t("rooms.work.timer.elapsedA11y", { minutes: Math.floor(seconds / 60) })
        }
      >
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.label, { color: theme.textMuted }]}>
          {t("rooms.work.timer.elapsed")}
        </Text>
        <Text
          maxFontSizeMultiplier={1.3}
          style={[styles.value, { color: theme.textPrimary }]}
          testID="timer-elapsed"
        >
          {seconds === null ? "—" : formatElapsed(seconds)}
        </Text>
      </View>
      {standard !== null ? (
        <View style={styles.block} accessible accessibilityLabel={t("rooms.work.timer.standardA11y", { minutes: standard })}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.label, { color: theme.textMuted }]}>
            {t("rooms.work.timer.standard")}
          </Text>
          <Text maxFontSizeMultiplier={1.3} style={[styles.value, { color: theme.textSecondary }]} testID="timer-standard">
            {t("rooms.work.timer.standardValue", { minutes: standard })}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: "row", borderWidth: 1, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12, gap: 24 },
  block: { gap: 2 },
  label: { fontSize: 11, fontWeight: "900", letterSpacing: 0.8, textTransform: "uppercase" },
  value: { fontFamily: monoFont, fontSize: 28, lineHeight: 34, fontWeight: "800" },
});
