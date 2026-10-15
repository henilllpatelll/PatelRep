import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { serifFont } from "@/components/shared/tokens";
import { Card } from "@/components/ui/Card";
import { Kicker, LinkButton, MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import type { RoomEntry } from "@/lib/housekeeping/myRoomsDashboard";
import { describeUpNext, roomContext } from "@/lib/housekeeping/homeText";
import type { TextContext } from "@/lib/housekeeping/myRoomsText";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

interface Props {
  entry: RoomEntry;
  t: Translate;
  ctx: TextContext;
  onOpenRoom: (roomId: string) => void;
  onViewRoute: () => void;
}

/** One upcoming room from the shared cleaning order. The full list lives in My Rooms. */
export function UpNextPreview({ entry, t, ctx, onOpenRoom, onViewRoute }: Props) {
  const theme = useTheme();
  const room = entry.room;
  const detail = describeUpNext(entry, t, ctx);
  const context = roomContext(room, t);

  return (
    <Card style={styles.card} testID="up-next">
      <Kicker>{t("home.upNext.kicker")}</Kicker>
      <Pressable
        onPress={() => onOpenRoom(room.id)}
        accessibilityRole="button"
        accessibilityLabel={[t("home.upNext.a11y", { room: room.room_number }), context, detail].filter(Boolean).join(". ")}
        style={({ pressed }) => [styles.row, pressed && { opacity: 0.65 }]}
        testID="up-next-room"
      >
        <View style={styles.text}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.number, { color: theme.textPrimary }]}>
            {t("rooms.dash.card.room", { room: room.room_number })}
          </Text>
          {context ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.context, { color: theme.textSecondary }]}>
              {context}
            </Text>
          ) : null}
          {detail ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.context, { color: theme.textSecondary, fontWeight: "600" }]}>
              {detail}
            </Text>
          ) : null}
        </View>
        <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
      </Pressable>
      <LinkButton label={t("home.upNext.viewRoute")} icon="arrow-forward" onPress={onViewRoute} testID="up-next-route" />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 4 },
  row: { minHeight: MIN_TARGET, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 4 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  number: { fontFamily: serifFont, fontSize: 26, lineHeight: 32 },
  context: { fontSize: 14, lineHeight: 19 },
});
