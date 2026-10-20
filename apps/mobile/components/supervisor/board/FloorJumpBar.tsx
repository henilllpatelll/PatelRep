import { Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import type { FloorJump } from "@/lib/housekeeping/roomBoardQuery";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

export function jumpLabel(jump: FloorJump, t: Translate): { short: string; full: string } {
  const level = jump.floor === null ? "?" : String(jump.floor);
  const fullLevel = jump.floor === null ? t("roomBoard.floorUnknown") : t("roomBoard.floor", { floor: jump.floor });
  if (!jump.buildingShown) return { short: level, full: fullLevel };
  const building = jump.building ?? t("roomBoard.buildingNone");
  return { short: jump.building ? `${jump.building}·${level}` : `–·${level}`, full: `${jump.building ? t("roomBoard.building", { building: jump.building }) : building}, ${fullLevel}` };
}

/** A strip of floor numbers that scrolls the board to that floor's heading. Shown only when there are several floors. */
export function FloorJumpBar({ jumps, onJump, t }: { jumps: FloorJump[]; onJump: (jump: FloorJump) => void; t: Translate }) {
  const theme = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.content}
      style={styles.scroll}
      keyboardShouldPersistTaps="handled"
      accessibilityLabel={t("roomBoard.jump.title")}
      testID="room-board-floor-jump"
    >
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.caption, { color: theme.textMuted }]} accessibilityElementsHidden importantForAccessibility="no">
        {t("roomBoard.jump.caption")}
      </Text>
      {jumps.map((jump) => {
        const label = jumpLabel(jump, t);
        return (
          <Pressable
            key={jump.key}
            onPress={() => onJump(jump)}
            accessibilityRole="button"
            accessibilityLabel={t("roomBoard.jump.item", { label: label.full })}
            testID={`room-board-jump-${jump.key}`}
            style={({ pressed }) => [styles.chip, { backgroundColor: theme.surface, borderColor: theme.border }, pressed && { opacity: 0.75 }]}
          >
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.chipText, { color: theme.textPrimary }]}>
              {label.short}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  content: { alignItems: "center", gap: 8, paddingHorizontal: 16, paddingBottom: 6 },
  caption: { fontSize: 12, fontWeight: "700" },
  chip: { minWidth: 44, minHeight: 44, paddingHorizontal: 12, borderWidth: 1, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  chipText: { fontSize: 14, fontWeight: "800" },
});
