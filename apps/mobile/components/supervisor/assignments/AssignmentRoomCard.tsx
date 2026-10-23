import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { getStatusMeta, StatusRail } from "@/components/shared/evening";
import { R, monoFont } from "@/components/shared/tokens";
import type { CardChip, CardCtaKind, RoomCardModel } from "@/lib/housekeeping/assignmentRoomsView";
import { useTheme } from "@/lib/theme/useTheme";

/* ─── Room card — one room in the assignment queue ──────────────────────────
   The whole card opens the room sheet; the call to action at the bottom names what happens next
   ("Assign", "View assignment", "View reason") and is part of the same tap target — it is never a second,
   competing control. Every priority and blocker is words plus an icon, never colour alone. A room that cannot
   be handed out shows "View reason", never an enabled Assign. */

interface Props {
  model: RoomCardModel;
  onOpen: (roomId: string, cta: CardCtaKind) => void;
}

const CTA_ICON: Record<CardCtaKind, "person-add-outline" | "chevron-forward" | "information-circle-outline" | "eye-outline"> = {
  assign: "person-add-outline",
  view_assignment: "chevron-forward",
  view_reason: "information-circle-outline",
  view: "eye-outline",
};

function RoomCardView({ model, onOpen }: Props) {
  const theme = useTheme();
  const meta = getStatusMeta(model.rawStatus, theme);
  const blocked = model.section === "blocked";
  const assigned = model.assignee.kind !== "none";
  const assigneeColor = assigned ? theme.textPrimary : blocked ? theme.textMuted : theme.status.dirty;
  const ctaColor = model.cta.kind === "assign" ? theme.primaryAction : theme.textSecondary;

  return (
    <Pressable
      onPress={() => onOpen(model.roomId, model.cta.kind)}
      accessibilityRole="button"
      accessibilityLabel={model.accessibilityLabel}
      testID={`assignment-room-${model.roomNumber}`}
      style={({ pressed }) => [styles.card, { backgroundColor: blocked ? theme.surfaceMuted : theme.surface, borderColor: theme.borderSubtle }, pressed && { opacity: 0.85 }]}
    >
      <StatusRail status={model.rawStatus} />
      <View style={styles.body}>
        <View style={styles.top}>
          <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={[styles.number, { color: theme.textPrimary }]} testID={`assignment-room-number-${model.roomNumber}`}>
            {model.roomNumber}
          </Text>
          <View style={[styles.statusPill, { backgroundColor: meta.bg, borderColor: meta.border }]} testID={`assignment-room-status-${model.roomNumber}`}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={1} style={[styles.statusText, { color: meta.fg }]}>
              {model.statusLabel}
            </Text>
          </View>
          <View style={styles.chips}>
            {model.chips.map((chip) => (
              <Chip key={chip.key} chip={chip} roomNumber={model.roomNumber} />
            ))}
          </View>
        </View>

        {model.location || model.detail ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={2} style={[styles.meta, { color: theme.textSecondary }]} testID={`assignment-room-meta-${model.roomNumber}`}>
            {[model.location, model.detail].filter(Boolean).join(" · ")}
          </Text>
        ) : null}

        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          numberOfLines={1}
          style={[styles.assignee, { color: assigneeColor }, !assigned && !blocked && styles.assigneeStrong]}
          testID={`assignment-room-assignee-${model.roomNumber}`}
        >
          {model.assignee.text}
        </Text>

        {model.deadline ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={1} style={[styles.deadline, { color: theme.status.pickup }]} testID={`assignment-room-deadline-${model.roomNumber}`}>
            {model.deadline}
          </Text>
        ) : null}

        {model.blocker ? (
          <View style={styles.blocker} testID={`assignment-room-blocker-${model.roomNumber}`}>
            <Ionicons name="alert-circle-outline" size={14} color={theme.textSecondary} />
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={2} style={[styles.blockerText, { color: theme.textSecondary }]}>
              {model.blocker}
            </Text>
          </View>
        ) : null}

        <View style={styles.cta} testID={`assignment-room-cta-${model.roomNumber}`}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.ctaText, { color: ctaColor }]}>
            {model.cta.label}
          </Text>
          <Ionicons name={CTA_ICON[model.cta.kind]} size={16} color={ctaColor} />
        </View>
      </View>
    </Pressable>
  );
}

function Chip({ chip, roomNumber }: { chip: CardChip; roomNumber: string }) {
  const theme = useTheme();
  const alert = chip.tone === "alert";
  const fg = alert ? theme.status.dirty : theme.status.pickup;
  const bg = alert ? theme.status.dirtySoft : theme.status.pickupSoft;
  const line = alert ? theme.status.dirtyLine : theme.status.pickupLine;
  const icon = chip.key === "vip" ? "star" : chip.key === "guest_waiting" ? "person" : "alert-circle";
  return (
    <View style={[styles.chip, { backgroundColor: bg, borderColor: line }]} testID={`assignment-room-chip-${roomNumber}-${chip.key}`}>
      <Ionicons name={icon} size={11} color={fg} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={1} style={[styles.chipText, { color: fg }]}>
        {chip.label}
      </Text>
    </View>
  );
}

export const AssignmentRoomCard = memo(RoomCardView, (prev, next) => prev.model.signature === next.model.signature && prev.onOpen === next.onOpen);

const styles = StyleSheet.create({
  card: { minHeight: 92, overflow: "hidden", borderWidth: 1, borderRadius: R.lg },
  body: { paddingLeft: 14, paddingRight: 12, paddingVertical: 10, gap: 4 },
  top: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  number: { fontFamily: monoFont, fontSize: 24, lineHeight: 28, fontWeight: "800" },
  statusPill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { fontSize: 10.5, fontWeight: "800", letterSpacing: 0.4, textTransform: "uppercase" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, flexShrink: 1 },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  chipText: { fontSize: 11, fontWeight: "800" },
  meta: { fontSize: 13, lineHeight: 18 },
  assignee: { fontSize: 14, fontWeight: "600" },
  assigneeStrong: { fontWeight: "800" },
  deadline: { fontSize: 12.5, fontWeight: "700" },
  blocker: { flexDirection: "row", alignItems: "center", gap: 6 },
  blockerText: { flex: 1, fontSize: 12.5, fontWeight: "600" },
  cta: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 6, minHeight: 32, marginTop: 2 },
  ctaText: { fontSize: 14, fontWeight: "800" },
});
