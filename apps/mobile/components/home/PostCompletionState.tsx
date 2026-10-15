import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Button } from "@/components/ui/Button";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { Kicker } from "@/components/home/homeUi";
import { describeUpNext, roomContext } from "@/lib/housekeeping/homeText";
import type { RoomEntry } from "@/lib/housekeeping/myRoomsDashboard";
import type { TextContext, Translate } from "@/lib/housekeeping/myRoomsText";
import { useTheme } from "@/lib/theme/useTheme";

export type CompletionOutcome = "confirmed" | "queued";

interface Props {
  outcome: CompletionOutcome;
  roomNumber: string;
  /** The next eligible room right now, or null when there is none. */
  next: RoomEntry | null;
  t: Translate;
  ctx: TextContext;
  onOpenNext: (roomId: string) => void;
  onOpenSync: () => void;
  onBackHome: () => void;
}

/**
 * What the person sees after finishing a room. A confirmed submission says so
 * and points at the next room; one that is only saved on this phone says that
 * instead, never "Clean", and keeps the way to Sync Status one tap away. It
 * never says the room is inspected: submitting makes it ready for inspection.
 */
export function PostCompletionState({ outcome, roomNumber, next, t, ctx, onOpenNext, onOpenSync, onBackHome }: Props) {
  const theme = useTheme();
  const confirmed = outcome === "confirmed";
  const color = confirmed ? theme.status.ready : theme.status.pickup;
  const detail = next ? describeUpNext(next, t, ctx) : null;

  return (
    <View style={styles.wrap} testID={`post-completion-${outcome}`}>
      <View style={styles.statusRow} accessible accessibilityRole="alert" accessibilityLabel={`${t(`home.postComplete.${outcome}Title`, { room: roomNumber })}. ${t(`home.postComplete.${outcome}Body`)}`}>
        <Ionicons name={confirmed ? "checkmark-circle" : "cloud-upload-outline"} size={30} color={color} />
        <View style={styles.statusText}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.textPrimary }]}>
            {t(`home.postComplete.${outcome}Title`, { room: roomNumber })}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
            {t(`home.postComplete.${outcome}Body`)}
          </Text>
        </View>
      </View>

      {next ? (
        <View style={[styles.next, { backgroundColor: theme.surfaceSubtle, borderColor: theme.borderSubtle }]} testID="post-completion-next">
          <Kicker>{t("home.postComplete.upNext")}</Kicker>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.nextRoom, { color: theme.textPrimary }]}>
            {t("rooms.dash.card.room", { room: next.room.room_number })}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
            {[roomContext(next.room, t), detail].filter(Boolean).join(" · ")}
          </Text>
        </View>
      ) : (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]} testID="post-completion-none">
          {t("home.postComplete.noneNext")}
        </Text>
      )}

      {next ? (
        <Button
          label={t("home.postComplete.openRoom", { room: next.room.room_number })}
          onPress={() => onOpenNext(next.room.id)}
          size="lg"
          testID="post-completion-open-next"
        />
      ) : null}
      {!confirmed ? <Button label={t("home.postComplete.syncStatus")} onPress={onOpenSync} variant="secondary" testID="post-completion-sync" /> : null}
      <Button label={t("home.postComplete.backHome")} onPress={onBackHome} variant={next ? "secondary" : "primary"} size={next ? "md" : "lg"} testID="post-completion-home" />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  statusRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  statusText: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 20, fontWeight: "800", lineHeight: 26 },
  body: { fontSize: 14, lineHeight: 20 },
  next: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 4 },
  nextRoom: { fontSize: 22, fontWeight: "800" },
});
