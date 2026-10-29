import { FlatList, Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { R, monoFont } from "@/components/shared/tokens";
import type { ChooserRoom } from "@/lib/housekeeping/assignmentPicker";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * "Assign more rooms" from a person's drawer: the rooms nobody owns and that may still be given to someone, in
 * priority order. Picking one hands off to the ONE single-room flow (opened at its review with this person
 * already chosen) — this list decides nothing and writes nothing.
 */
export function AssignRoomChooserSheet({
  personName,
  rooms,
  t,
  onChoose,
  onClose,
}: {
  personName: string;
  rooms: ChooserRoom[];
  t: Translate;
  onChoose: (roomId: string) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const renderRoom = ({ item }: { item: ChooserRoom }) => {
    const meta = [
      item.cleanTypeLabel,
      item.estimateMinutes !== null ? t("assignments.v2.assign.picker.estimate", { minutes: item.estimateMinutes }) : t("assignments.v2.assign.picker.noEstimate"),
      item.building ? t("roomBoard.building", { building: item.building }) : null,
      item.floor !== null ? t("roomBoard.floor", { floor: item.floor }) : null,
    ]
      .filter(Boolean)
      .join(" · ");
    const priority = item.priorityReasons.map((reason) => t(`assignments.v2.priority.${reason}`)).join(" · ");
    const held = item.heldBack.length > 0 ? t("assignments.v2.assign.team.heldBack") : "";
    return (
      <Pressable
        onPress={() => onChoose(item.roomId)}
        accessibilityRole="button"
        accessibilityLabel={[t("assignments.v2.assign.team.roomLabel", { room: item.roomNumber }), meta, priority, held].filter(Boolean).join(". ")}
        style={({ pressed }) => [styles.room, { backgroundColor: theme.surface, borderColor: theme.border }, pressed && { opacity: 0.85 }]}
        testID={`assign-chooser-room-${item.roomNumber}`}
      >
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.roomNumber, { color: theme.textPrimary }]}>
          {item.roomNumber}
        </Text>
        <View style={styles.roomBody}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textSecondary }]}>
            {meta}
          </Text>
          {priority ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textPrimary, fontWeight: "700" }]}>
              {priority}
            </Text>
          ) : null}
          {held ? (
            <View style={styles.held}>
              <Ionicons name="alert-circle-outline" size={13} color={theme.destructiveAction} />
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.destructiveAction }]}>
                {held}
              </Text>
            </View>
          ) : null}
        </View>
        <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
      </Pressable>
    );
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common.close")} testID="assign-chooser-backdrop" />
        <View style={[styles.sheet, { backgroundColor: theme.background, paddingBottom: Math.max(12, insets.bottom + 8) }]} accessibilityViewIsModal testID="assign-chooser-sheet">
          <View style={[styles.grabber, { backgroundColor: theme.border }]} />
          <View style={styles.bar}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]} testID="assign-chooser-title">
              {t("assignments.v2.assign.team.chooserTitle", { name: personName })}
            </Text>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common.close")} style={styles.close} testID="assign-chooser-close">
              <Ionicons name="close" size={22} color={theme.textPrimary} />
            </Pressable>
          </View>
          <FlatList
            data={rooms}
            keyExtractor={(room) => room.roomId}
            renderItem={renderRoom}
            ItemSeparatorComponent={Separator}
            ListHeaderComponent={
              rooms.length > 0 ? (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.caption, { color: theme.textMuted }]}>
                  {t("assignments.v2.assign.team.chooserCaption")}
                </Text>
              ) : undefined
            }
            ListEmptyComponent={
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.empty, { color: theme.textSecondary }]} testID="assign-chooser-empty">
                {t("assignments.v2.assign.team.chooserEmpty")}
              </Text>
            }
            contentContainerStyle={styles.listContent}
            initialNumToRender={10}
            windowSize={7}
            testID="assign-chooser-list"
          />
        </View>
      </View>
    </Modal>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { maxHeight: "88%", borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 8 },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, marginBottom: 2 },
  bar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16 },
  title: { flex: 1, fontSize: 18, fontWeight: "800" },
  close: { minHeight: MIN_TARGET, minWidth: MIN_TARGET, alignItems: "center", justifyContent: "center" },
  listContent: { paddingHorizontal: 16, paddingBottom: 12 },
  caption: { fontSize: 12, fontWeight: "700", letterSpacing: 0.3, paddingBottom: 8 },
  room: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, borderWidth: 1, borderRadius: R.md, paddingHorizontal: 14, paddingVertical: 10 },
  roomNumber: { width: 56, fontFamily: monoFont, fontSize: 20, fontWeight: "800" },
  roomBody: { flex: 1, minWidth: 0, gap: 2 },
  meta: { fontSize: 12.5, lineHeight: 17 },
  held: { flexDirection: "row", alignItems: "center", gap: 4 },
  separator: { height: 8 },
  empty: { fontSize: 14, lineHeight: 20, paddingVertical: 18, textAlign: "center" },
});
