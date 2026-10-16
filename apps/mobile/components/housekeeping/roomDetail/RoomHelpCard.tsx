import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { useAssistantOptional } from "@/lib/ai/AssistantProvider";
import { isAssistantRole } from "@/lib/ai/fab";
import { ProcedureLinks } from "@/components/sop/ProcedureLinks";
import { useRelatedProcedures } from "@/lib/sop/useRelatedProcedures";
import { useTheme } from "@/lib/theme/useTheme";
import { useAppStore, type Room } from "@/stores/appStore";
import { MAX_FONT_SCALE } from "./BottomSheet";

interface Props {
  room: Room;
  /** A clean is open on this room: the assistant is then about the cleaning, not just the room. */
  live: boolean;
  /** Existing Report an issue form; offered next to Ask while a clean is underway. */
  onReportIssue?: () => void;
  variant: "before" | "active";
}

/**
 * "Need help with this room?" The assistant is a quiet second choice here: the cleaning actions stay the
 * primary controls, nothing is sent until the person asks something, and the assistant is told which room
 * (the server checks the room belongs to this person before it uses it). Housekeepers only.
 */
export function RoomHelpCard({ room, live, onReportIssue, variant }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const assistant = useAssistantOptional();
  const { user } = useAppStore();
  const role = user?.effective_role ?? user?.role;
  const offered = !!assistant && isAssistantRole(role);
  // The hotel's own cleaning procedure, if it has one: a plain link to the document, never a model call. Opening it
  // pushes a screen on top of this one, so the open clean, its checklist and its timer are left exactly as they are.
  const related = useRelatedProcedures(["clean"], offered);
  if (!assistant || !offered) return null;

  const ask = () =>
    assistant.openAssistant({
      contextType: live ? "cleaningSession" : "room",
      entityId: room.id,
      label: room.room_number,
    });

  /* "Find a procedure": the assistant opens about this room with the question started for them. Nothing is asked
     until they send it, so opening this screen never costs a model call; the answer comes only from approved procedures. */
  const findProcedure = () => {
    assistant.setPendingHint("sop_query");
    assistant.openAssistant({
      contextType: live ? "cleaningSession" : "room",
      entityId: room.id,
      label: room.room_number,
      prefill: t("copilot.quickPrompts.searchSOPs"),
    });
  };

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]} testID="room-help-card">
      <View style={styles.head}>
        <Ionicons name="sparkles-outline" size={16} color={theme.textMuted} />
        <Text accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.eyebrow, { color: theme.textMuted }]}>
          {t(variant === "active" ? "rooms.help.needHelp" : "rooms.help.needHelpRoom")}
        </Text>
      </View>
      <View style={styles.buttons}>
        <Button
          label={t(variant === "active" ? "rooms.help.askAi" : "rooms.help.askAbout", { room: room.room_number })}
          onPress={ask}
          variant="secondary"
          icon="sparkles-outline"
          style={styles.button}
          testID="room-help-ask"
        />
        <Button
          label={t("rooms.help.findProcedure")}
          onPress={findProcedure}
          variant="secondary"
          icon="book-outline"
          style={styles.button}
          testID="room-help-procedure"
        />
        {variant === "active" && onReportIssue ? (
          <Button label={t("rooms.help.reportIssue")} onPress={onReportIssue} variant="secondary" icon="warning-outline" style={styles.button} testID="room-help-report" />
        ) : null}
      </View>
      <ProcedureLinks docs={related} onOpen={(id) => router.push(`/(app)/sop/${encodeURIComponent(id)}` as never)} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 10 },
  head: { flexDirection: "row", alignItems: "center", gap: 6 },
  eyebrow: { fontSize: 11, fontWeight: "900", letterSpacing: 0.8, textTransform: "uppercase" },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  button: { flexGrow: 1, flexBasis: 150 },
});
