import type { ComponentProps } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { lightTheme, monoFont } from "@/components/shared/tokens";
import { useTheme } from "@/lib/theme/useTheme";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/Button";
import {
  dueState,
  formatClock,
  formatDuration,
  minutesSince,
  workOrderLocation,
  type WorkOrder,
} from "@/lib/engineering/workOrders";

/* ─── Work-order card — Evening Lobby work card for the Orders tab ──────────
   Mirrors TaskCard: left urgency rail, category identity tile, big readable
   title, quiet meta chips. Priority only speaks when urgent; "normal" stays
   silent. The Claim action lives on the card so an engineer can grab work
   without opening the detail first. */

type IconName = ComponentProps<typeof Ionicons>["name"];

/** CATEGORY_META is consumed as a plain object (no hook) by [woId].tsx and
 * EngineerHome.tsx — both out of this plan's scope — so it stays sourced
 * from the static `lightTheme` export (identical values to the app's only
 * active theme this milestone) rather than the reactive `useTheme()` hook. */
export const CATEGORY_META: Record<string, { icon: IconName; fg: string; bg: string }> = {
  plumbing: { icon: "water-outline", fg: lightTheme.status.clean, bg: lightTheme.status.cleanSoft },
  electrical: { icon: "flash-outline", fg: lightTheme.status.pickup, bg: lightTheme.status.pickupSoft },
  hvac: { icon: "thermometer-outline", fg: lightTheme.primary, bg: lightTheme.primarySoft },
  furniture: { icon: "bed-outline", fg: lightTheme.accentBrass, bg: lightTheme.accentBrassSoft },
  appliance: { icon: "tv-outline", fg: lightTheme.status.clean, bg: lightTheme.status.cleanSoft },
  structural: { icon: "business-outline", fg: lightTheme.textSecondary, bg: lightTheme.surfaceMuted },
  safety: { icon: "warning-outline", fg: lightTheme.status.dirty, bg: lightTheme.status.dirtySoft },
  general: { icon: "construct-outline", fg: lightTheme.textSecondary, bg: lightTheme.surfaceMuted },
};

interface WorkOrderCardProps {
  wo: WorkOrder;
  locale: string;
  onPress: () => void;
  /** Render the inline Claim action (open, unassigned, viewer can claim). */
  onClaim?: () => void;
  claiming?: boolean;
}

export function WorkOrderCard({ wo, locale, onPress, onClaim, claiming }: WorkOrderCardProps) {
  const { t } = useTranslation();
  const theme = useTheme();

  const categoryKey = wo.category && CATEGORY_META[wo.category] ? wo.category : "general";
  const category = CATEGORY_META[categoryKey];
  const { room, text } = workOrderLocation(wo);
  const isEmergency = wo.priority === "emergency";
  const isUrgent = wo.priority === "urgent";
  const onHold = wo.status === "on_hold";
  const done = wo.status === "completed";
  const due = dueState(wo, locale);
  const isAlert = isEmergency || isUrgent || due?.kind === "overdue";
  const railColor = isAlert ? theme.status.dirty : onHold ? theme.status.pickup : theme.border;

  const ageMinutes = minutesSince(wo.created_at);
  const elapsed = wo.status === "in_progress" ? minutesSince(wo.started_at) : null;
  const doneClock = done ? formatClock(wo.completed_at, locale) : null;

  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={wo.title} testID={`wo-${wo.id}`}>
      <Card style={[styles.cardLayoutOverrides, isAlert && { borderColor: theme.status.dirtyLine }]}>
        <View style={[styles.rail, { backgroundColor: railColor }]} />

        <View style={styles.main}>
          <View
            accessible
            accessibilityLabel={t(`workOrders.category.${categoryKey}`)}
            style={[styles.typeTile, { backgroundColor: category.bg }]}
          >
            <Ionicons name={category.icon} size={17} color={category.fg} />
          </View>

          <View style={styles.body}>
            <Text style={[styles.title, { color: theme.textPrimary }]} numberOfLines={2}>
              {wo.title}
            </Text>

            {wo.description ? (
              <Text style={[styles.description, { color: theme.textMuted }]} numberOfLines={1}>
                {wo.description}
              </Text>
            ) : null}

            <View style={styles.metaRow}>
              <View style={[styles.categoryChip, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]}>
                <Text style={[styles.categoryChipText, { color: theme.textMuted }]}>
                  {t(`workOrders.category.${categoryKey}`)}
                </Text>
              </View>
              {isEmergency ? (
                <StatusBadge statusKey="emergency" label={t("workOrders.chipEmergency")} />
              ) : isUrgent ? (
                <StatusBadge statusKey="urgent" label={t("workOrders.chipUrgent")} />
              ) : wo.priority === "low" ? (
                <StatusBadge statusKey="low" label="LOW" />
              ) : null}
              {onHold ? <StatusBadge statusKey="onHold" label={t("workOrders.chipOnHold")} /> : null}
              {room ? (
                <View style={styles.locChip}>
                  <Ionicons name="location-outline" size={10} color={theme.textSecondary} />
                  <Text style={[styles.locChipText, { color: theme.textSecondary }]}>{room}</Text>
                </View>
              ) : text ? (
                <View style={styles.locChip}>
                  <Ionicons name="location-outline" size={10} color={theme.textSecondary} />
                  <Text style={[styles.locTextPlain, { color: theme.textSecondary }]} numberOfLines={1}>
                    {text}
                  </Text>
                </View>
              ) : null}
              {wo.guest_reported ? (
                <View style={styles.guestChip}>
                  <Ionicons name="person-outline" size={10} color={theme.status.clean} />
                  <Text style={[styles.guestChipText, { color: theme.status.clean }]}>
                    {t("workOrders.chipGuest")}
                  </Text>
                </View>
              ) : null}

              {done && doneClock ? (
                <Text style={[styles.doneText, { color: theme.status.ready }]}>
                  {t("workOrders.doneAt", { time: doneClock })}
                </Text>
              ) : due?.kind === "overdue" ? (
                <Text style={[styles.overdueText, { color: theme.status.dirty }]}>
                  {t("workOrders.overdueBy", { time: formatDuration(due.minutes) })}
                </Text>
              ) : elapsed != null ? (
                <View style={styles.dueRow}>
                  <Ionicons name="stopwatch-outline" size={11} color={theme.status.pickup} />
                  <Text style={[styles.elapsedText, { color: theme.status.pickup }]}>
                    {t("workOrders.onClock", { time: formatDuration(elapsed) })}
                  </Text>
                </View>
              ) : due?.kind === "due" ? (
                (() => {
                  const minutesToSla = wo.due_at
                    ? Math.floor((new Date(wo.due_at).getTime() - Date.now()) / 60000)
                    : null;
                  return isUrgent && minutesToSla != null && minutesToSla > 0 ? (
                    <View style={styles.dueRow}>
                      <Ionicons name="timer-outline" size={11} color={theme.status.dirty} />
                      <Text style={[styles.dueText, { color: theme.status.dirty, fontWeight: "800" }]}>
                        {t("workOrders.minutesToSla", { minutes: minutesToSla })}
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.dueRow}>
                      <Ionicons name="time-outline" size={11} color={theme.textMuted} />
                      <Text style={[styles.dueText, { color: theme.textMuted }]}>
                        {t("workOrders.dueAt", { time: due.clock })}
                      </Text>
                    </View>
                  );
                })()
              ) : ageMinutes != null ? (
                <Text style={[styles.ageText, { color: theme.textDisabled }]}>
                  {t("workOrders.ago", { time: formatDuration(ageMinutes) })}
                </Text>
              ) : null}
            </View>
          </View>

          {done ? (
            <View style={[styles.doneBadge, { backgroundColor: theme.status.readySoft }]}>
              <Ionicons name="checkmark" size={16} color={theme.status.ready} />
            </View>
          ) : !onClaim ? (
            <Ionicons name="chevron-forward" size={15} color={theme.textDisabled} style={styles.chevron} />
          ) : null}
        </View>

        {onClaim ? (
          <Button
            label={t("workOrders.claim")}
            onPress={onClaim}
            loading={claiming}
            variant="secondary"
            size="sm"
            icon="hand-right-outline"
            style={styles.claimBtn}
          />
        ) : null}
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cardLayoutOverrides: {
    position: "relative",
    overflow: "hidden",
    paddingLeft: 16,
    paddingRight: 12,
    paddingVertical: 13,
    gap: 10,
  },
  rail: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4 },

  main: { flexDirection: "row", alignItems: "flex-start", gap: 11 },
  typeTile: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  body: { flex: 1, minWidth: 0, gap: 5 },
  title: { fontSize: 15, fontWeight: "700", lineHeight: 20 },
  description: { fontSize: 12.5, lineHeight: 17 },

  metaRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 2 },
  categoryChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  categoryChipText: { fontSize: 9.5, fontWeight: "700" },
  locChip: { flexDirection: "row", alignItems: "center", gap: 3, maxWidth: 160 },
  locChipText: { fontSize: 12, fontWeight: "700", fontFamily: monoFont },
  locTextPlain: { fontSize: 11.5, fontWeight: "600" },
  guestChip: { flexDirection: "row", alignItems: "center", gap: 3 },
  guestChipText: { fontSize: 11.5, fontWeight: "700" },
  dueRow: { flexDirection: "row", alignItems: "center", gap: 3, marginLeft: "auto" },
  dueText: { fontSize: 11, fontFamily: monoFont },
  overdueText: { marginLeft: "auto", fontSize: 11, fontWeight: "800", fontFamily: monoFont },
  elapsedText: { fontSize: 11, fontWeight: "700", fontFamily: monoFont },
  ageText: { marginLeft: "auto", fontSize: 11, fontFamily: monoFont },
  doneText: { marginLeft: "auto", fontSize: 11, fontWeight: "700", fontFamily: monoFont },

  chevron: { marginTop: 11 },
  doneBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },

  claimBtn: { marginTop: 2 },
});
