import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { R, monoFont } from "@/components/shared/tokens";
import { ValueLine, WarningLines } from "@/components/supervisor/assignments/AssignWorkloadParts";
import { Body, Notice, SectionLabel } from "@/components/supervisor/assignments/BulkParts";
import { SheetHeader, Stat } from "@/components/supervisor/assignments/SmartBalanceParts";
import { Button } from "@/components/ui/Button";
import { attendanceLabel, minutesText, missingText } from "@/lib/housekeeping/assignmentFlowText";
import { noteLines, partialLine, staleText, statusLine } from "@/lib/housekeeping/smartBalanceText";
import type { SmartBalanceController } from "@/lib/housekeeping/useSmartBalance";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/* ─── The preview ───────────────────────────────────────────────────────────
   Every number comes from the plan and the verified board (see smartBalancePreview.ts). It shows what the plan would
   do to each person's workload, who gets which rooms, why some rooms were left out, and what is uncertain. NOTHING here
   is live: "Add to draft" only stages proposed changes for the Phase 5 review, which is where publishing happens. */

export function SmartBalancePreviewStep({ smart, dateLabel, nameOf, onRefresh, t }: { smart: SmartBalanceController; dateLabel: string | null; nameOf: (userId: string) => string; onRefresh: () => void; t: Translate }) {
  const theme = useTheme();
  const { plan, preview, stale, paused } = smart;
  if (!plan || !preview) return null;
  const { counts } = preview;
  const status = statusLine(plan, preview, t);
  const partial = partialLine(preview, t);
  const notes = noteLines(preview, plan, t);
  const staleNow = stale.length > 0;
  const excluded = counts.excludedRooms + counts.excludedStaff + counts.unallocated + counts.takenOut;
  const canAdd = !staleNow && paused === null && preview.changes.length > 0;
  const firstPerson = preview.staff[0]?.userId ?? null;

  return (
    <>
      <SheetHeader title={t("assignments.v2.smart.preview.title")} onBack={smart.back} backLabel={t("assignments.v2.smart.preview.back")} testID="smart-preview" />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} testID="smart-preview-scroll">
        <View>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.heading, { color: theme.textPrimary }]}>
            {t("assignments.v2.smart.preview.heading")}
          </Text>
          {dateLabel ? <Body tone="secondary">{t("assignments.v2.smart.preview.generatedFor", { date: dateLabel })}</Body> : null}
        </View>

        <View style={styles.stats} accessible accessibilityLabel={[t("assignments.v2.smart.preview.summary.planned", { count: counts.planned }), t("assignments.v2.smart.preview.summary.affected", { count: counts.affectedStaff }), t("assignments.v2.smart.preview.summary.urgent", { count: counts.urgentCovered }), t("assignments.v2.smart.preview.summary.excluded", { count: counts.excludedRooms })].join(". ")} testID="smart-summary">
          <Stat text={t("assignments.v2.smart.preview.summary.planned", { count: counts.planned })} testID="smart-stat-planned" />
          <Stat text={t("assignments.v2.smart.preview.summary.affected", { count: counts.affectedStaff })} testID="smart-stat-affected" />
          <Stat text={t("assignments.v2.smart.preview.summary.urgent", { count: counts.urgentCovered })} testID="smart-stat-urgent" />
          <Stat text={t("assignments.v2.smart.preview.summary.excluded", { count: counts.excludedRooms })} tone={counts.excludedRooms > 0 ? "alert" : "primary"} testID="smart-stat-excluded" />
        </View>

        {staleNow ? (
          <View style={[styles.stale, { borderColor: theme.destructiveAction, backgroundColor: theme.surfaceMuted }]} accessibilityRole="alert" testID="smart-stale">
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.staleTitle, { color: theme.textPrimary }]}>
              {t("assignments.v2.smart.preview.stale.title")}
            </Text>
            <Body tone="secondary">{t("assignments.v2.smart.preview.stale.body")}</Body>
            {stale.map((reason) => (
              <Body key={reason.kind} tone="secondary">
                • {staleText(reason, nameOf, t)}
              </Body>
            ))}
            <Button label={t("assignments.v2.smart.preview.actions.refresh")} icon="refresh-outline" onPress={onRefresh} testID="smart-refresh-replan" />
          </View>
        ) : null}
        {paused ? (
          <Notice icon="cloud-offline-outline" testID="smart-paused" live>
            {t(`assignments.v2.smart.preview.paused.${paused}`)}
          </Notice>
        ) : null}
        {status ? (
          <Notice icon="information-circle-outline" tone={plan.status === "no_safe_plan" ? "alert" : "info"} testID="smart-status">
            {status.body ? `${status.title} ${status.body}` : status.title}
          </Notice>
        ) : null}
        {partial ? (
          <Notice icon="alert-circle-outline" tone="alert" testID="smart-partial">
            {partial}
          </Notice>
        ) : null}

        {preview.staff.length > 0 ? (
          <>
            <SectionLabel>{t("assignments.v2.smart.preview.workload.title")}</SectionLabel>
            {preview.staff.map((person) => {
              const name = person.name ?? t("assignments.v2.smart.detail.unnamed");
              const incomplete = missingText(person.after.minutes, t) ?? missingText(person.before.minutes, t);
              return (
                <View key={person.userId} style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]} testID={`smart-workload-${person.userId}`}>
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.name, { color: theme.textPrimary }]}>
                    {name}
                  </Text>
                  {person.attendance !== "on_shift" ? <Body tone="muted">{attendanceLabel(person.attendance, t)}</Body> : null}
                  <ValueLine label={t("assignments.v2.smart.preview.workload.before")} value={minutesText(person.before.minutes, t)} testID={`smart-before-${person.userId}`} />
                  <ValueLine label={t("assignments.v2.smart.preview.workload.after")} value={minutesText(person.after.minutes, t)} strong testID={`smart-after-${person.userId}`} />
                  {incomplete ? (
                    <Body tone="muted" testID={`smart-incomplete-${person.userId}`}>
                      {t("assignments.v2.smart.preview.workload.incomplete")}
                    </Body>
                  ) : null}
                  {person.admitted ? <Body tone="alert">{t(`assignments.v2.smart.preview.workload.admitted.${person.admitted}`)}</Body> : null}
                  <WarningLines warnings={person.newWarnings} t={t} testIDPrefix={`smart-warning-${person.userId}`} />
                </View>
              );
            })}

            <SectionLabel>{t("assignments.v2.smart.preview.distribution.title")}</SectionLabel>
            {preview.staff.map((person) => {
              const name = person.name ?? t("assignments.v2.smart.detail.unnamed");
              const counts2 = [person.gainsNew.length > 0 ? t("assignments.v2.smart.preview.distribution.new", { count: person.gainsNew.length }) : null, person.gainsMoved.length > 0 ? t("assignments.v2.smart.preview.distribution.moved", { count: person.gainsMoved.length }) : null, person.releases.length > 0 ? t("assignments.v2.smart.preview.workload.releases", { count: person.releases.length }) : null].filter(Boolean).join(" · ");
              return (
                <Pressable
                  key={person.userId}
                  onPress={() => smart.openDetail(person.userId)}
                  accessibilityRole="button"
                  accessibilityLabel={`${name}. ${counts2}. ${person.gains.join(", ")}`}
                  accessibilityHint={t("assignments.v2.smart.preview.distribution.open", { name })}
                  style={({ pressed }) => [styles.card, { backgroundColor: theme.surface, borderColor: theme.border }, pressed && { opacity: 0.85 }]}
                  testID={`smart-distribution-${person.userId}`}
                >
                  <View style={styles.rowTop}>
                    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.name, { color: theme.textPrimary }]}>
                      {name}
                    </Text>
                    <Body tone="secondary">{counts2}</Body>
                    <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
                  </View>
                  <View style={styles.chips}>
                    {person.gains.map((number) => (
                      <Text key={number} maxFontSizeMultiplier={1.3} style={[styles.chip, { color: theme.textPrimary, borderColor: theme.border }]}>
                        {number}
                      </Text>
                    ))}
                  </View>
                </Pressable>
              );
            })}
          </>
        ) : null}

        {notes.length > 0 ? (
          <View style={styles.notes} testID="smart-notes">
            <SectionLabel>{t("assignments.v2.smart.preview.notes.title")}</SectionLabel>
            {notes.map((line) => (
              <Body key={line} tone="secondary">
                • {line}
              </Body>
            ))}
          </View>
        ) : null}

        {excluded > 0 ? (
          <Pressable onPress={smart.openExceptions} accessibilityRole="button" accessibilityLabel={t("assignments.v2.smart.preview.why", { count: counts.excludedRooms })} style={({ pressed }) => [styles.link, pressed && { opacity: 0.85 }]} testID="smart-open-exceptions">
            <Body strong style={{ color: theme.primaryAction }}>
              {t("assignments.v2.smart.preview.why", { count: counts.excludedRooms })}
            </Body>
            <Ionicons name="chevron-forward" size={16} color={theme.primaryAction} />
          </Pressable>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <Button label={t("assignments.v2.smart.preview.actions.addToDraft")} icon="create-outline" onPress={() => smart.addToDraft()} disabled={!canAdd} accessibilityLabel={`${t("assignments.v2.smart.preview.actions.addToDraft")}. ${t("assignments.v2.smart.preview.actions.hint")}`} testID="smart-add-to-draft" />
        <View style={styles.secondary}>
          <Button label={t("assignments.v2.smart.preview.actions.adjust")} variant="secondary" onPress={() => firstPerson && smart.openDetail(firstPerson)} disabled={firstPerson === null} style={styles.half} testID="smart-adjust" />
          <Button label={t("assignments.v2.smart.preview.actions.discard")} variant="ghost" onPress={smart.requestDiscard} style={styles.half} testID="smart-discard" />
        </View>
        {smart.canUndo ? (
          <Pressable onPress={smart.undo} accessibilityRole="button" style={styles.undo} testID="smart-undo">
            <Body strong style={{ color: theme.primaryAction }}>
              {t("assignments.v2.smart.preview.actions.undo")}
            </Body>
          </Pressable>
        ) : null}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0, marginTop: 8 },
  content: { gap: 10, paddingBottom: 12 },
  heading: { fontSize: 22, fontWeight: "800" },
  stats: { flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: 4 },
  stale: { borderWidth: 1.5, borderRadius: R.lg, padding: 12, gap: 6 },
  staleTitle: { fontSize: 15.5, fontWeight: "800" },
  card: { borderWidth: 1, borderRadius: R.lg, paddingHorizontal: 14, paddingVertical: 10, gap: 2 },
  name: { fontSize: 16, fontWeight: "800", flexShrink: 1 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingTop: 6 },
  chip: { fontFamily: monoFont, fontSize: 15, fontWeight: "700", borderWidth: 1, borderRadius: R.sm, paddingHorizontal: 8, paddingVertical: 3 },
  notes: { gap: 4 },
  link: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: MIN_TARGET },
  footer: { paddingTop: 8, gap: 6 },
  secondary: { flexDirection: "row", gap: 8 },
  half: { flex: 1 },
  undo: { minHeight: MIN_TARGET, alignItems: "center", justifyContent: "center" },
});
