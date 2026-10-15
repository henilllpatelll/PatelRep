import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { SheetGone, SheetNotice, SheetSection, SheetSubtitle } from "@/components/home/sheetParts";
import type { WhyRoomView } from "@/lib/housekeeping/homeSheets";
import { formatClock } from "@/lib/housekeeping/myRoomsText";
import { describeRecommendation, roomContext } from "@/lib/housekeeping/homeText";
import type { TextContext, Translate } from "@/lib/housekeeping/myRoomsText";
import { useTheme } from "@/lib/theme/useTheme";

interface Props {
  visible: boolean;
  view: WhyRoomView;
  t: Translate;
  ctx: TextContext;
  onOpenRoom: (roomId: string) => void;
  onOpenMyRooms: () => void;
  onClose: () => void;
}

/**
 * "Why this room?" in plain operational language. The lines come from the same
 * structured recommendation that ranks the rooms (verified facts only), never
 * from AI, and never show scores or rule names. If the ranking moves while the
 * drawer is open it describes, and opens, the room that is first NOW.
 */
export function RecommendationSheet({ visible, view, t, ctx, onOpenRoom, onOpenMyRooms, onClose }: Props) {
  const theme = useTheme();

  if (view.state === "none") {
    return (
      <BottomSheet visible={visible} title={t("home.whySheet.noneTitle")} onClose={onClose} grabber testID="why-sheet">
        <SheetGone
          title={t("home.whySheet.noneTitle")}
          body={t("home.whySheet.noneBody")}
          closeLabel={t("common.close")}
          onClose={onClose}
          testID="why-none"
        />
        <Button label={t("home.whySheet.openMyRooms")} onPress={onOpenMyRooms} variant="secondary" testID="why-open-my-rooms" />
      </BottomSheet>
    );
  }

  const { recommendation, changed, freshness } = view;
  const room = recommendation.room;
  const copy = describeRecommendation(recommendation, t, ctx);
  const updated = formatClock(freshness.updatedAt, ctx);
  // Only a real fact: the lead is never a restricted room, so "no restriction" is true of exactly what is shown.
  const accessClear = !recommendation.entry.classification.restricted;

  return (
    <BottomSheet
      visible={visible}
      title={t("home.whySheet.title", { room: room.room_number })}
      onClose={onClose}
      grabber
      testID="why-sheet"
      footer={
        <>
          <Button
            label={t("home.whySheet.open", { room: room.room_number })}
            onPress={() => onOpenRoom(room.id)}
            size="lg"
            icon="arrow-forward"
            testID="why-open-room"
          />
          <Button label={t("home.whySheet.viewAll")} onPress={onOpenMyRooms} variant="secondary" testID="why-view-all" />
        </>
      }
    >
      {changed ? <SheetNotice tone="warn" text={t("home.whySheet.changed", { room: room.room_number })} testID="why-changed" /> : null}
      {freshness.state === "offline" ? <SheetNotice tone="warn" text={t("home.whySheet.offline")} testID="why-offline" /> : null}
      {freshness.state === "stale" ? <SheetNotice tone="warn" text={t("home.whySheet.stale")} testID="why-stale" /> : null}
      {freshness.state === "cached" ? <SheetNotice tone="warn" text={t("home.whySheet.cached")} testID="why-cached" /> : null}
      <SheetSubtitle text={roomContext(room, t)} />
      <SheetSection title={t("home.whySheet.because")}>
        {copy.reasons.map((line, index) => (
          <View key={`${index}-${line}`} style={styles.reason} testID={`why-reason-${index}`}>
            <Ionicons name="checkmark-circle-outline" size={18} color={theme.primary} style={styles.icon} />
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.reasonText, { color: theme.textPrimary }]}>
              {line}
            </Text>
          </View>
        ))}
        {accessClear ? (
          <View style={styles.reason} testID="why-access-clear">
            <Ionicons name="checkmark-circle-outline" size={18} color={theme.primary} style={styles.icon} />
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.reasonText, { color: theme.textPrimary }]}>
              {t("home.whySheet.accessClear")}
            </Text>
          </View>
        ) : null}
      </SheetSection>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.estimate, { color: theme.textMuted }]} testID="why-estimate">
        {copy.estimate}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.estimate, { color: theme.textMuted }]} testID="why-disclaimer">
        {t("home.whySheet.noOverride")}
      </Text>
      {updated ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.estimate, { color: theme.textMuted }]} testID="why-updated">
          {t("home.whySheet.updatedAt", { time: updated })}
        </Text>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  reason: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  icon: { marginTop: 1 },
  reasonText: { flex: 1, fontSize: 15, lineHeight: 21 },
  estimate: { fontSize: 12, lineHeight: 17 },
});
