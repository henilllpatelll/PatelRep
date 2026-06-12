import type { ComponentProps } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { C, R, monoFont } from "@/components/shared/tokens";
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

export const CATEGORY_META: Record<string, { icon: IconName; fg: string; bg: string }> = {
  plumbing: { icon: "water-outline", fg: C.info, bg: C.infoSoft },
  electrical: { icon: "flash-outline", fg: C.caution, bg: C.cautionSoft },
  hvac: { icon: "thermometer-outline", fg: C.primary, bg: C.accentSoft },
  furniture: { icon: "bed-outline", fg: C.brass, bg: C.brassSoft },
  appliance: { icon: "tv-outline", fg: C.info, bg: C.infoSoft },
  structural: { icon: "business-outline", fg: C.ink2, bg: C.surface3 },
  safety: { icon: "warning-outline", fg: C.alert, bg: C.alertSoft },
  general: { icon: "construct-outline", fg: C.ink2, bg: C.surface3 },
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

  const categoryKey = wo.category && CATEGORY_META[wo.category] ? wo.category : "general";
  const category = CATEGORY_META[categoryKey];
  const { room, text } = workOrderLocation(wo);
  const isUrgent = wo.priority === "urgent";
  const onHold = wo.status === "on_hold";
  const done = wo.status === "completed";
  const due = dueState(wo, locale);
  const railColor = isUrgent || due?.kind === "overdue" ? C.alert : onHold ? C.caution : C.line;

  const ageMinutes = minutesSince(wo.created_at);
  const doneClock = done ? formatClock(wo.completed_at, locale) : null;

  return (
    <TouchableOpacity
      style={[styles.card, (isUrgent || due?.kind === "overdue") && styles.cardAlert]}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={wo.title}
      testID={`wo-${wo.id}`}
    >
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
          <Text style={styles.title} numberOfLines={2}>
            {wo.title}
          </Text>

          {wo.description ? (
            <Text style={styles.description} numberOfLines={1}>
              {wo.description}
            </Text>
          ) : null}

          <View style={styles.metaRow}>
            {isUrgent ? (
              <View style={styles.urgentChip}>
                <Ionicons name="flash" size={9} color={C.alert} />
                <Text style={styles.urgentChipText}>{t("workOrders.chipUrgent")}</Text>
              </View>
            ) : null}
            {onHold ? (
              <View style={styles.holdChip}>
                <Text style={styles.holdChipText}>{t("workOrders.chipOnHold")}</Text>
              </View>
            ) : null}
            {room ? (
              <View style={styles.locChip}>
                <Ionicons name="location-outline" size={10} color={C.ink2} />
                <Text style={styles.locChipText}>{room}</Text>
              </View>
            ) : text ? (
              <View style={styles.locChip}>
                <Ionicons name="location-outline" size={10} color={C.ink2} />
                <Text style={styles.locTextPlain} numberOfLines={1}>
                  {text}
                </Text>
              </View>
            ) : null}
            {wo.guest_reported ? (
              <View style={styles.guestChip}>
                <Ionicons name="person-outline" size={10} color={C.info} />
                <Text style={styles.guestChipText}>{t("workOrders.chipGuest")}</Text>
              </View>
            ) : null}

            {done && doneClock ? (
              <Text style={styles.doneText}>{t("workOrders.doneAt", { time: doneClock })}</Text>
            ) : due?.kind === "overdue" ? (
              <Text style={styles.overdueText}>
                {t("workOrders.overdueBy", { time: formatDuration(due.minutes) })}
              </Text>
            ) : due?.kind === "due" ? (
              <View style={styles.dueRow}>
                <Ionicons name="time-outline" size={11} color={C.ink3} />
                <Text style={styles.dueText}>{t("workOrders.dueAt", { time: due.clock })}</Text>
              </View>
            ) : ageMinutes != null ? (
              <Text style={styles.ageText}>
                {t("workOrders.ago", { time: formatDuration(ageMinutes) })}
              </Text>
            ) : null}
          </View>
        </View>

        {done ? (
          <View style={styles.doneBadge}>
            <Ionicons name="checkmark" size={16} color={C.ready} />
          </View>
        ) : !onClaim ? (
          <Ionicons name="chevron-forward" size={15} color={C.ink4} style={styles.chevron} />
        ) : null}
      </View>

      {onClaim ? (
        <TouchableOpacity
          style={styles.claimBtn}
          onPress={onClaim}
          disabled={claiming}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={t("workOrders.claimA11y", { title: wo.title })}
        >
          {claiming ? (
            <ActivityIndicator size="small" color={C.accent} />
          ) : (
            <>
              <Ionicons name="hand-right-outline" size={14} color={C.accent} />
              <Text style={styles.claimText}>{t("workOrders.claim")}</Text>
            </>
          )}
        </TouchableOpacity>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "relative",
    overflow: "hidden",
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: R.lg,
    paddingLeft: 16,
    paddingRight: 12,
    paddingVertical: 13,
    gap: 10,
    shadowColor: C.ink,
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  cardAlert: { borderColor: C.alertLine },
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
  title: { color: C.ink, fontSize: 15, fontWeight: "700", lineHeight: 20 },
  description: { color: C.ink3, fontSize: 12.5, lineHeight: 17 },

  metaRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 2 },
  urgentChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: C.alertSoft,
    borderWidth: 1,
    borderColor: C.alertLine,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  urgentChipText: { color: C.alert, fontSize: 9.5, fontWeight: "800", letterSpacing: 0.4 },
  holdChip: {
    backgroundColor: C.cautionSoft,
    borderWidth: 1,
    borderColor: C.cautionLine,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  holdChipText: { color: C.caution, fontSize: 9.5, fontWeight: "800", letterSpacing: 0.4 },
  locChip: { flexDirection: "row", alignItems: "center", gap: 3, maxWidth: 160 },
  locChipText: { color: C.ink2, fontSize: 12, fontWeight: "700", fontFamily: monoFont },
  locTextPlain: { color: C.ink2, fontSize: 11.5, fontWeight: "600" },
  guestChip: { flexDirection: "row", alignItems: "center", gap: 3 },
  guestChipText: { color: C.info, fontSize: 11.5, fontWeight: "700" },
  dueRow: { flexDirection: "row", alignItems: "center", gap: 3, marginLeft: "auto" },
  dueText: { color: C.ink3, fontSize: 11, fontFamily: monoFont },
  overdueText: { marginLeft: "auto", color: C.alert, fontSize: 11, fontWeight: "800", fontFamily: monoFont },
  ageText: { marginLeft: "auto", color: C.ink4, fontSize: 11, fontFamily: monoFont },
  doneText: { marginLeft: "auto", color: C.ready, fontSize: 11, fontWeight: "700", fontFamily: monoFont },

  chevron: { marginTop: 11 },
  doneBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: C.readySoft,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },

  claimBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 44,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: C.accentLine,
    backgroundColor: C.accentSoft,
  },
  claimText: { color: C.accent, fontSize: 13, fontWeight: "700" },
});
