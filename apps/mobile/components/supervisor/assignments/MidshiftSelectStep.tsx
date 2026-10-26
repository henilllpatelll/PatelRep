import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { Body, Notice, SectionLabel } from "@/components/supervisor/assignments/BulkParts";
import { MovableRoomRow, ProtectedRoomRow } from "@/components/supervisor/assignments/MidshiftParts";
import { Button } from "@/components/ui/Button";
import { minutesLine } from "@/lib/housekeeping/assignmentBulkView";
import { MIDSHIFT_REASONS, type MidshiftRoom } from "@/lib/housekeeping/assignmentMidshift";
import { attentionText, blockedText, nameOrFallback, reasonLabel } from "@/lib/housekeeping/assignmentMidshiftText";
import type { MidshiftController } from "@/lib/housekeeping/useMidshiftRecovery";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/* ─── Step 1 — what to move ─────────────────────────────────────────────────
   The person's day split in two: work that can move (selectable) and work that stays (explained, never selectable).
   "Select all" is `selectAllMovable`: a protected, held-back or out-of-service room can never be in it. */

export function MidshiftSelectStep({ midshift, t, onOpenBoard }: { midshift: MidshiftController; t: Translate; onOpenBoard: (roomId: string) => void }) {
  const theme = useTheme();
  const { source, summary } = midshift;
  if (!source || !summary) return null;
  const name = nameOrFallback(source.name, t);
  const movable = source.rooms.filter((room) => room.movable);
  const staying = source.rooms.filter((room) => !room.movable);
  const attention = attentionText(source.attention, name, t);
  const { counts } = source;
  const allSelected = movable.length > 0 && movable.every((room) => midshift.selected.has(room.roomId));
  const blocked = midshift.blocked;

  const header = (
    <View style={styles.block}>
      {attention ? (
        <Notice icon="alert-circle-outline" testID="midshift-attention">
          {attention}
        </Notice>
      ) : null}
      <View style={[styles.stats, { backgroundColor: theme.surface, borderColor: theme.border }]} testID="midshift-current-work">
        <SectionLabel>{t("assignments.v2.midshift.select.currentWork")}</SectionLabel>
        <Body strong>{t("assignments.v2.midshift.select.stats", { completed: counts.completed, inProgress: counts.inProgress, notStarted: counts.notStarted })}</Body>
      </View>
      <SectionLabel>{t("assignments.v2.midshift.select.movableHeading")}</SectionLabel>
      {movable.length === 0 ? <Body tone="secondary" testID="midshift-none-movable">{t("assignments.v2.midshift.select.noMovable")}</Body> : null}
      {movable.length > 0 ? (
        <View style={styles.bulkRow}>
          <Button
            label={allSelected ? t("assignments.v2.midshift.select.clearAll") : t("assignments.v2.midshift.select.selectAll")}
            variant="secondary"
            onPress={allSelected ? midshift.clearSelection : midshift.selectAll}
            testID="midshift-select-all"
          />
        </View>
      ) : null}
    </View>
  );

  const footerList = (
    <View style={styles.block}>
      {staying.length > 0 ? (
        <View style={styles.block} testID="midshift-staying">
          <SectionLabel>{t("assignments.v2.midshift.select.protectedHeading", { name })}</SectionLabel>
          {staying.map((room) => (
            <ProtectedRoomRow key={room.roomId} room={room} name={name} onOpenBoard={onOpenBoard} t={t} />
          ))}
        </View>
      ) : null}
      <View style={styles.block} testID="midshift-reason">
        <SectionLabel>{t("assignments.v2.midshift.select.reasonHeading")}</SectionLabel>
        <View style={styles.chips}>
          {MIDSHIFT_REASONS.map((reason) => {
            const on = midshift.reason === reason;
            return (
              <Pressable
                key={reason}
                onPress={() => midshift.setReason(on ? null : reason)}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={reasonLabel(reason, t)}
                style={[styles.chip, { backgroundColor: on ? theme.surface : theme.surfaceMuted, borderColor: on ? theme.primaryAction : theme.border }]}
                testID={`midshift-reason-${reason}`}
              >
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.chipText, { color: theme.textPrimary }]}>
                  {reasonLabel(reason, t)}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Body tone="muted">{t("assignments.v2.midshift.select.reasonNote")}</Body>
      </View>
    </View>
  );

  return (
    <>
      <FlatList
        data={movable}
        keyExtractor={(room: MidshiftRoom) => room.roomId}
        renderItem={({ item }) => <MovableRoomRow room={item} selected={midshift.selected.has(item.roomId)} onToggle={midshift.toggleRoom} t={t} />}
        ListHeaderComponent={header}
        ListFooterComponent={footerList}
        ItemSeparatorComponent={Separator}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={12}
        windowSize={7}
        testID="midshift-select-list"
      />
      <View style={styles.footer}>
        {summary.invalid.length > 0 ? (
          <Notice tone="alert" icon="alert-circle-outline" live testID="midshift-invalid">
            {t("assignments.v2.midshift.select.invalid", { count: summary.invalid.length })}
          </Notice>
        ) : null}
        <Body strong testID="midshift-selection-summary">
          {summary.valid.length > 0 ? t("assignments.v2.midshift.select.summary", { count: summary.valid.length, value: minutesLine(summary.minutes, t) }) : t("assignments.v2.midshift.select.none")}
        </Body>
        {blocked ? (
          <Body tone="muted" testID="midshift-blocked">
            {blockedText(blocked, midshift.paused, t)}
          </Body>
        ) : null}
        <Button label={t("assignments.v2.midshift.select.next")} icon="arrow-forward-outline" onPress={midshift.next} disabled={blocked !== null} testID="midshift-next" />
      </View>
    </>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  list: { flex: 1, marginTop: 8 },
  listContent: { paddingBottom: 12 },
  block: { gap: 8, paddingBottom: 8 },
  stats: { borderWidth: 1, borderRadius: R.lg, paddingHorizontal: 14, paddingVertical: 12, gap: 4 },
  bulkRow: { flexDirection: "row" },
  separator: { height: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: MIN_TARGET, justifyContent: "center", paddingHorizontal: 14, borderWidth: 1.5, borderRadius: 22 },
  chipText: { fontSize: 14, fontWeight: "700" },
  footer: { gap: 8, paddingTop: 8 },
});
