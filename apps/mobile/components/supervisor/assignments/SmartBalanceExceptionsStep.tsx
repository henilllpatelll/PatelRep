import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { R, monoFont } from "@/components/shared/tokens";
import { Body, Notice, SectionLabel } from "@/components/supervisor/assignments/BulkParts";
import { SheetHeader } from "@/components/supervisor/assignments/SmartBalanceParts";
import { Button } from "@/components/ui/Button";
import { leftOutText, roomExclusionText, staffExclusionText } from "@/lib/housekeeping/smartBalanceText";
import type { SmartBalanceController } from "@/lib/housekeeping/useSmartBalance";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/* ─── Planning exceptions ───────────────────────────────────────────────────
   Why rooms and people are NOT in the plan, each with the real reason: a blocked room names its block, a room the plan
   could not fit says capacity or "the planner couldn't allocate it", a person says break / shift ended / not verified /
   no capacity. A blocked room is never offered for an automatic assignment here - the only action is to go and look at
   it (the supervisor decides on that room alone). */

export function SmartBalanceExceptionsStep({ smart, onViewRoom, onViewStaff, t }: { smart: SmartBalanceController; onViewRoom: (roomId: string) => void; onViewStaff: (userId: string) => void; t: Translate }) {
  const theme = useTheme();
  const { plan, preview } = smart;
  if (!plan || !preview) return null;
  const rooms = [...plan.excludedRooms].sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }));
  const empty = rooms.length === 0 && plan.excludedStaff.length === 0 && preview.leftOut.length === 0 && plan.protectedInProgress === 0;

  return (
    <>
      <SheetHeader title={t("assignments.v2.smart.exceptions.title")} onBack={smart.back} backLabel={t("assignments.v2.smart.preview.back")} testID="smart-exceptions" />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} testID="smart-exceptions-scroll">
        {empty ? <Notice testID="smart-exceptions-empty">{t("assignments.v2.smart.exceptions.empty")}</Notice> : null}

        {rooms.length > 0 ? (
          <>
            <SectionLabel>{t("assignments.v2.smart.exceptions.rooms", { count: rooms.length })}</SectionLabel>
            {rooms.map((room) => {
              const text = roomExclusionText(room.exclusion, t);
              return (
                <View key={room.roomId} style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]} testID={`smart-excluded-${room.roomNumber}`}>
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityLabel={t("assignments.v2.smart.exceptions.roomLabel", { room: room.roomNumber })} style={[styles.number, { color: theme.textPrimary }]}>
                    {room.roomNumber}
                  </Text>
                  <Body strong>{text.title}</Body>
                  {text.body ? <Body tone="secondary">{text.body}</Body> : null}
                  <Pressable onPress={() => onViewRoom(room.roomId)} accessibilityRole="button" accessibilityLabel={`${t("assignments.v2.smart.exceptions.viewRoom")} ${room.roomNumber}`} style={styles.action} testID={`smart-view-room-${room.roomNumber}`}>
                    <Body strong style={{ color: theme.primaryAction }}>
                      {t("assignments.v2.smart.exceptions.viewRoom")}
                    </Body>
                  </Pressable>
                </View>
              );
            })}
          </>
        ) : null}

        {preview.leftOut.length > 0 ? (
          <>
            <SectionLabel>{t("assignments.v2.smart.exceptions.unallocatedTitle")}</SectionLabel>
            {preview.leftOut.map((item) => (
              <View key={item.roomId} style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]} testID={`smart-leftout-${item.roomNumber}`}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.number, { color: theme.textPrimary }]}>
                  {item.roomNumber}
                </Text>
                <Body strong>{leftOutText(item.reason, t)}</Body>
                <Pressable onPress={() => onViewRoom(item.roomId)} accessibilityRole="button" accessibilityLabel={`${t("assignments.v2.smart.exceptions.viewRoom")} ${item.roomNumber}`} style={styles.action}>
                  <Body strong style={{ color: theme.primaryAction }}>
                    {t("assignments.v2.smart.exceptions.viewRoom")}
                  </Body>
                </Pressable>
              </View>
            ))}
          </>
        ) : null}

        {plan.protectedInProgress > 0 ? <Notice testID="smart-protected">{t("assignments.v2.smart.exceptions.protectedRow", { count: plan.protectedInProgress })}</Notice> : null}

        {plan.excludedStaff.length > 0 ? (
          <>
            <SectionLabel>{t("assignments.v2.smart.exceptions.staffTitle")}</SectionLabel>
            {plan.excludedStaff.map((person) => (
              <View key={person.userId} style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]} testID={`smart-excluded-staff-${person.userId}`}>
                <Body strong>{person.name ?? t("assignments.v2.smart.detail.unnamed")}</Body>
                <Body tone="secondary">{staffExclusionText(person.reason, t)}</Body>
                <Pressable onPress={() => onViewStaff(person.userId)} accessibilityRole="button" accessibilityLabel={`${t("assignments.v2.smart.exceptions.viewStaff")} ${person.name ?? ""}`} style={styles.action}>
                  <Body strong style={{ color: theme.primaryAction }}>
                    {t("assignments.v2.smart.exceptions.viewStaff")}
                  </Body>
                </Pressable>
              </View>
            ))}
          </>
        ) : null}
      </ScrollView>
      <View style={styles.footer}>
        <Button label={t("assignments.v2.smart.exceptions.done")} onPress={smart.back} testID="smart-exceptions-done" />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0, marginTop: 8 },
  content: { gap: 10, paddingBottom: 12 },
  card: { borderWidth: 1, borderRadius: R.lg, paddingHorizontal: 14, paddingVertical: 10, gap: 2 },
  number: { fontFamily: monoFont, fontSize: 21, fontWeight: "800" },
  action: { minHeight: MIN_TARGET, justifyContent: "center", alignSelf: "flex-start" },
  footer: { paddingTop: 8 },
});
