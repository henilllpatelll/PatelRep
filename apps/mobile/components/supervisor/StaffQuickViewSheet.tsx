import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { SheetGone, SheetNotice, SheetSection } from "@/components/home/sheetParts";
import { R } from "@/components/shared/tokens";
import { Avatar } from "@/components/shared/mobileHandoff";
import { ProgressBar } from "@/components/supervisor/today/TodayBlocks";
import { Button } from "@/components/ui/Button";
import { availabilityKey, buildStaffQuickView, roleKey, type StaffQuickView } from "@/lib/housekeeping/supervisorComms";
import type { Derived } from "@/lib/housekeeping/supervisorSources";
import type { TeamPulse } from "@/lib/housekeeping/supervisorTeam";
import { useTheme } from "@/lib/theme/useTheme";

interface Props {
  /** The person the sheet is open for; null = closed. */
  userId: string | null;
  team: Derived<TeamPulse>;
  isOnline: boolean;
  onMessage: (view: StaffQuickView) => void;
  onViewAssignments: () => void;
  onClose: () => void;
}

/**
 * A supervisor's quick look at one housekeeper. Everything comes from the same team snapshot the Team Pulse
 * card uses, re-resolved by id on every render, so the sheet and the card cannot disagree and a person who
 * drops off the list reads as "no longer on your team list". It reads; it never reassigns or changes a room.
 *
 * Words matter here: "Cleaned" = cleaning submitted OR inspected; only "Passed inspection" means a room
 * was approved. Shift status is shown only from the roster, and an unreadable roster is "unknown".
 */
export function StaffQuickViewSheet({ userId, team, isOnline, onMessage, onViewAssignments, onClose }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const view = useMemo(() => {
    const member = userId ? team.value?.members.find((m) => m.userId === userId) : undefined;
    return member ? buildStaffQuickView(member) : null;
  }, [userId, team.value]);

  if (!userId) return null;

  if (!view) {
    return (
      <BottomSheet visible title={t("supervisorComms.quick.title")} onClose={onClose} grabber testID="staff-quick-sheet">
        <SheetGone
          title={t("supervisorComms.quick.title")}
          body={t("supervisorComms.quick.gone")}
          closeLabel={t("supervisorComms.quick.goneClose")}
          onClose={onClose}
          testID="staff-quick-gone"
        />
      </BottomSheet>
    );
  }

  const name = view.name ?? t("supervisorToday.attention.someone");
  const role = roleKey(view.role);
  const status = t(availabilityKey(view.availability));
  const rosterStatus = team.value?.roster.status;
  const rosterNote =
    rosterStatus === "stale" ? t("supervisorComms.quick.rosterStale") : rosterStatus === "unknown" ? t("supervisorComms.quick.rosterUnknown") : null;

  return (
    <BottomSheet
      visible
      title={name}
      onClose={onClose}
      grabber
      testID="staff-quick-sheet"
      footer={
        <View style={styles.footer}>
          <Button
            label={t("supervisorComms.quick.message")}
            onPress={() => onMessage(view)}
            icon="chatbubble-ellipses-outline"
            disabled={!isOnline}
            testID="staff-quick-message"
          />
          <Button
            label={t("supervisorComms.quick.viewAll")}
            onPress={onViewAssignments}
            variant="secondary"
            icon="arrow-forward-circle-outline"
            testID="staff-quick-assignments"
          />
        </View>
      }
    >
      <View style={styles.body}>
        <View style={styles.identity}>
          <Avatar name={name} size={46} />
          <View style={styles.identityText}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.role, { color: theme.textSecondary }]} testID="staff-quick-role">
              {role ? t(role) : " "}
            </Text>
            <Text
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              style={[styles.status, { color: view.availability === "on_shift" ? theme.status.ready : theme.textMuted }]}
              testID="staff-quick-status"
            >
              {status}
            </Text>
          </View>
        </View>
        {rosterNote ? <SheetNotice text={rosterNote} testID="staff-quick-roster-note" /> : null}
        {!isOnline ? <SheetNotice text={t("supervisorComms.offline")} tone="warn" testID="staff-quick-offline" /> : null}

        <SheetSection>
          {view.assigned === 0 ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sub, { color: theme.textSecondary }]} testID="staff-quick-norooms">
              {t("supervisorComms.quick.noRooms")}
            </Text>
          ) : (
            <View style={styles.progress}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.progressText, { color: theme.textPrimary }]} testID="staff-quick-progress">
                {t("supervisorComms.quick.progress", { done: view.cleaned, count: view.assigned })}
              </Text>
              <ProgressBar fraction={view.cleaned / view.assigned} color={theme.status.ready} height={8} testID="staff-quick-bar" />
              <View style={styles.stats}>
                <Stat label={t("supervisorComms.quick.cleaned")} value={view.cleaned} testID="staff-quick-cleaned" />
                <Stat label={t("supervisorComms.quick.inspected")} value={view.inspected} testID="staff-quick-inspected" />
                <Stat label={t("supervisorComms.quick.awaiting")} value={view.awaitingInspection} testID="staff-quick-awaiting" />
                <Stat label={t("supervisorComms.quick.remaining")} value={view.remaining} testID="staff-quick-remaining" />
              </View>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>
                {t("supervisorComms.quick.cleanedHint")}
              </Text>
            </View>
          )}
        </SheetSection>

        {view.assigned > 0 ? (
          <SheetSection title={t("supervisorComms.quick.remainingTitle")}>
            {view.remaining === 0 ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sub, { color: theme.textSecondary }]} testID="staff-quick-allcleaned">
                {t("supervisorComms.quick.allCleaned")}
              </Text>
            ) : (
              <View style={styles.rooms}>
                {view.remainingRooms.map((room) => (
                  <View
                    key={room.roomId}
                    style={[styles.room, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}
                    testID={`staff-quick-room-${room.roomId}`}
                    accessible
                    accessibilityLabel={[
                      room.roomNumber,
                      t(`supervisorComms.quick.status.${room.status}`),
                      room.vip ? t("supervisorComms.quick.vip") : null,
                      room.dnd ? t("supervisorComms.quick.dnd") : null,
                    ]
                      .filter(Boolean)
                      .join(". ")}
                  >
                    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.roomNumber, { color: theme.textPrimary }]}>
                      {room.roomNumber}
                    </Text>
                    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.roomStatus, { color: theme.textSecondary }]} numberOfLines={1}>
                      {t(`supervisorComms.quick.status.${room.status}`)}
                    </Text>
                    {room.vip ? <Text style={[styles.tag, { color: theme.status.pickup }]}>{t("supervisorComms.quick.vip")}</Text> : null}
                    {room.dnd ? <Text style={[styles.tag, { color: theme.status.dirty }]}>{t("supervisorComms.quick.dnd")}</Text> : null}
                  </View>
                ))}
                {view.hiddenRemaining > 0 ? (
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]} testID="staff-quick-more">
                    {t("supervisorComms.quick.moreRooms", { count: view.hiddenRemaining })}
                  </Text>
                ) : null}
              </View>
            )}
          </SheetSection>
        ) : null}
      </View>
    </BottomSheet>
  );
}

function Stat({ label, value, testID }: { label: string; value: number; testID: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.stat, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]} testID={testID} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.statValue, { color: theme.textPrimary }]}>
        {value}
      </Text>
      <Text maxFontSizeMultiplier={1.3} style={[styles.statLabel, { color: theme.textMuted }]} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: 14 },
  identity: { flexDirection: "row", alignItems: "center", gap: 12 },
  identityText: { flex: 1, gap: 2 },
  role: { fontSize: 14, fontWeight: "600" },
  status: { fontSize: 14, fontWeight: "700" },
  sub: { fontSize: 14, lineHeight: 20 },
  progress: { gap: 10 },
  progressText: { fontSize: 15, fontWeight: "700" },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  stat: { flexGrow: 1, flexBasis: "22%", minWidth: 70, borderWidth: 1, borderRadius: R.md, paddingVertical: 8, paddingHorizontal: 8, alignItems: "center", gap: 2 },
  statValue: { fontSize: 20, fontWeight: "800" },
  statLabel: { fontSize: 11, fontWeight: "600", textAlign: "center" },
  hint: { fontSize: 12.5, lineHeight: 17 },
  rooms: { gap: 6 },
  room: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 10, minHeight: 44 },
  roomNumber: { fontSize: 16, fontWeight: "800", minWidth: 48 },
  roomStatus: { flex: 1, fontSize: 13.5 },
  tag: { fontSize: 11.5, fontWeight: "800" },
  footer: { gap: 8 },
});
