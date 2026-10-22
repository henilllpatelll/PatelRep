import { StyleSheet, Text, View } from "react-native";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { R, monoFont } from "@/components/shared/tokens";
import type { RoomFacts } from "@/lib/inspections/workspaceText";
import type { Translate } from "@/lib/inspections/viewText";
import { useTheme } from "@/lib/theme/useTheme";

/* The room being inspected, compactly: number, status, and only the facts that are actually recorded. */
export function RoomSummary({ facts, t }: { facts: RoomFacts; t: Translate }) {
  const theme = useTheme();
  const tone = facts.reinspection
    ? { fg: theme.status.pickup, bg: theme.status.pickupSoft, line: theme.status.pickupLine }
    : { fg: theme.status.clean, bg: theme.status.cleanSoft, line: theme.status.cleanLine };
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]} testID="workspace-room">
      <View style={styles.top}>
        <View style={styles.numberCol}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.kicker, { color: theme.textMuted }]}>
            {t("inspect.workspace.roomKicker")}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.number, { color: theme.textPrimary }]} testID="workspace-room-number">
            {facts.room}
          </Text>
        </View>
        <View style={[styles.chip, { backgroundColor: tone.bg, borderColor: tone.line }]} testID="workspace-room-status">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.chipText, { color: tone.fg }]}>
            {t(facts.reinspection ? "inspect.workspace.status.reinspection" : "inspect.workspace.status.awaiting")}
          </Text>
        </View>
      </View>
      {facts.details ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.line, { color: theme.textPrimary }]} testID="workspace-room-details">
          {facts.details}
        </Text>
      ) : null}
      {facts.cleaned ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sub, { color: theme.textSecondary }]} testID="workspace-room-cleaned">
          {facts.cleaned}
        </Text>
      ) : null}
      {facts.checklist ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sub, { color: theme.textMuted }]} testID="workspace-room-checklist">
          {facts.checklist}
        </Text>
      ) : null}
      {facts.reinspection && facts.recheckCount > 0 ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sub, { color: theme.status.pickup, fontWeight: "700" }]} testID="workspace-room-recheck">
          {t("inspect.workspace.recheck", { count: facts.recheckCount })}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: R.lg, paddingHorizontal: 14, paddingVertical: 12, gap: 3 },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  numberCol: { flexShrink: 1 },
  kicker: { fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  number: { fontFamily: monoFont, fontSize: 30, lineHeight: 34, fontWeight: "800" },
  chip: { flexShrink: 1, borderWidth: 1, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 },
  chipText: { fontSize: 12, fontWeight: "800" },
  line: { fontSize: 15, lineHeight: 21, fontWeight: "700" },
  sub: { fontSize: 13, lineHeight: 18, fontWeight: "600" },
});
