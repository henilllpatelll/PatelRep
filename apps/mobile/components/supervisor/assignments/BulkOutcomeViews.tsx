import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { Body, Notice } from "@/components/supervisor/assignments/BulkParts";
import { Button } from "@/components/ui/Button";
import type { BatchConflict } from "@/lib/housekeeping/assignmentBatch";
import type { BulkAssignmentController } from "@/lib/housekeeping/useBulkAssignment";
import type { PublicationState } from "@/lib/housekeeping/useBatchPublication";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/* ─── What became of a publication ───────────────────────────────────────────
   One view per state the server can leave us in. Wording follows the proof we have:
     published       the server confirmed; every number comes from ITS answer
     not published   the server refused and rolled back: nothing changed, the draft is still here
     checking        no answer: we ask, read-only, and never say "published" or "not published" until it does */

function Hero({ icon, tone, title, testID }: { icon: React.ComponentProps<typeof Ionicons>["name"]; tone: "good" | "alert" | "wait"; title: string; testID: string }) {
  const theme = useTheme();
  const color = tone === "good" ? theme.status.ready : tone === "alert" ? theme.destructiveAction : theme.textSecondary;
  return (
    <View style={styles.hero} accessible accessibilityRole="header" accessibilityLabel={title} testID={testID}>
      {tone === "wait" ? <ActivityIndicator color={theme.textSecondary} /> : <Ionicons name={icon} size={30} color={color} />}
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.heroTitle, { color: theme.textPrimary }]}>
        {title}
      </Text>
    </View>
  );
}

export function PublishingView({ t }: { t: Translate }) {
  return (
    <View style={styles.view} testID="bulk-publishing">
      <Hero icon="cloud-upload-outline" tone="wait" title={t("assignments.v2.bulk.publishing.title")} testID="bulk-publishing-title" />
      <View accessibilityLiveRegion="polite">
        <Body tone="secondary">{t("assignments.v2.bulk.publishing.body")}</Body>
      </View>
    </View>
  );
}

export function CommittedView({ bulk, state, onViewTeam, t }: { bulk: BulkAssignmentController; state: Extract<PublicationState, { kind: "committed" }>; onViewTeam: () => void; t: Translate }) {
  const { publication, refresh } = state;
  const { counts } = publication;
  const lines = (["assign", "reassign", "remove"] as const).filter((kind) => counts[kind] > 0);
  return (
    <View style={styles.view} testID="bulk-committed">
      <Hero icon="checkmark-circle" tone="good" title={t("assignments.v2.bulk.committed.title")} testID="bulk-committed-title" />
      <View accessibilityLiveRegion="polite" style={styles.lines}>
        <Body strong testID="bulk-committed-total">
          {t("assignments.v2.bulk.committed.confirmed", { count: counts.total })}
        </Body>
        {lines.map((kind) => (
          <Body key={kind} testID={`bulk-committed-${kind}`}>
            {t(`assignments.v2.bulk.committed.${kind}`, { count: counts[kind] })}
          </Body>
        ))}
        <Body>{t("assignments.v2.bulk.committed.people", { count: publication.affectedHousekeeperIds.length })}</Body>
        {publication.replayed ? <Body tone="muted">{t("assignments.v2.bulk.committed.replayed")}</Body> : null}
      </View>
      {refresh === "failed" ? (
        <Notice tone="alert" icon="alert-circle-outline" live testID="bulk-committed-refresh-failed">
          {t("assignments.v2.bulk.committed.refreshFailed")}
        </Notice>
      ) : refresh === "pending" ? (
        <Body tone="muted" testID="bulk-committed-refreshing">
          {t("assignments.v2.bulk.committed.refreshing")}
        </Body>
      ) : null}
      <Button label={t("assignments.v2.bulk.committed.returnToRooms")} icon="grid-outline" onPress={bulk.finish} testID="bulk-committed-return" />
      <Button label={t("assignments.v2.bulk.committed.viewTeam")} variant="secondary" icon="people-outline" onPress={onViewTeam} testID="bulk-committed-team" />
    </View>
  );
}

function conflictLine(conflict: BatchConflict, bulk: BulkAssignmentController, t: Translate): string {
  const draftRoom = bulk.draft.draft?.changes[conflict.roomId]?.roomNumber;
  const room = conflict.roomNumber ?? draftRoom ?? "";
  switch (conflict.code) {
    case "assignment_changed": {
      const name = bulk.nameOf(conflict.currentOwnerId ?? null);
      return conflict.currentOwnerId === null
        ? t("assignments.v2.bulk.conflict.nowUnassigned", { room })
        : conflict.currentOwnerId === undefined
          ? t("assignments.v2.bulk.conflict.assignmentChanged", { room })
          : t("assignments.v2.bulk.conflict.nowAssigned", { room, name: name ?? t("assignments.v2.assign.unnamed") });
    }
    case "room_not_assignable":
      return t("assignments.v2.bulk.conflict.notAssignable", { room });
    case "room_blocked":
      return t("assignments.v2.bulk.conflict.blocked", { room });
    case "invalid_housekeeper":
      return t("assignments.v2.bulk.conflict.invalidHousekeeper", { room });
    default:
      return t("assignments.v2.bulk.conflict.roomMissing", { room });
  }
}

export function RejectedView({ bulk, state, t }: { bulk: BulkAssignmentController; state: Extract<PublicationState, { kind: "rejected" }>; t: Translate }) {
  const { failure, conflicts } = state;
  const refreshable = failure.reason === "conflict" || failure.reason === "date_changed";
  return (
    <View style={styles.view} testID="bulk-rejected">
      <Hero icon="alert-circle" tone="alert" title={t(failure.reason === "conflict" ? "assignments.v2.bulk.conflict.title" : "assignments.v2.bulk.rejected.title")} testID="bulk-rejected-title" />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.lines}>
        <Body tone="secondary">{t(failure.reason === "conflict" ? "assignments.v2.bulk.conflict.body" : `assignments.v2.bulk.rejected.reason.${failure.reason}`)}</Body>
        {conflicts.map((conflict) => (
          <Body key={conflict.roomId} strong testID={`bulk-conflict-${conflict.roomId}`}>
            {conflictLine(conflict, bulk, t)}
          </Body>
        ))}
        <Body strong testID="bulk-rejected-none">
          {t("assignments.v2.bulk.conflict.nothingPublished")}
        </Body>
      </ScrollView>
      {refreshable ? <Button label={t("assignments.v2.bulk.conflict.refresh")} icon="refresh-outline" onPress={() => void bulk.refreshAndReview()} testID="bulk-conflict-refresh" /> : null}
      <Button label={t(refreshable ? "assignments.v2.bulk.conflict.cancel" : "assignments.v2.bulk.conflict.backToReview")} variant={refreshable ? "secondary" : "primary"} onPress={bulk.publication.dismiss} testID="bulk-rejected-back" />
    </View>
  );
}

export function UnknownView({ bulk, state, t }: { bulk: BulkAssignmentController; state: Extract<PublicationState, { kind: "unknown" }>; t: Translate }) {
  const { publication } = bulk;
  const canSendAgain = state.check === "not_found" && !state.recovered;
  const canAbandon = state.check === "not_found" && state.recovered;
  const bodyKey = state.checking || state.check === "unchecked" ? "checking" : state.check;
  return (
    <View style={styles.view} testID="bulk-unknown">
      <Hero icon="help-circle-outline" tone={state.checking ? "wait" : "alert"} title={t("assignments.v2.bulk.unknown.title")} testID="bulk-unknown-title" />
      <View accessibilityLiveRegion="polite" style={styles.lines}>
        <Body>{t(`assignments.v2.bulk.unknown.${bodyKey}`, { count: state.changeCount })}</Body>
        {state.recovered ? <Body tone="muted">{t("assignments.v2.bulk.unknown.recovered")}</Body> : null}
        <Body tone="muted">{t("assignments.v2.bulk.unknown.noSecond")}</Body>
      </View>
      {canSendAgain ? <Button label={t("assignments.v2.bulk.unknown.sendAgain")} icon="cloud-upload-outline" onPress={() => void publication.sendAgain()} disabled={bulk.paused !== null || publication.working} testID="bulk-unknown-send-again" /> : null}
      {canAbandon ? <Button label={t("assignments.v2.bulk.unknown.abandon")} onPress={publication.abandon} testID="bulk-unknown-abandon" /> : null}
      {!canAbandon ? <Button label={t("assignments.v2.bulk.unknown.check")} variant={canSendAgain ? "secondary" : "primary"} icon="search-outline" onPress={() => void publication.checkResult()} disabled={publication.working || bulk.paused === "offline"} loading={state.checking} testID="bulk-unknown-check" /> : null}
      <Button label={t("assignments.v2.bulk.unknown.close")} variant="ghost" onPress={bulk.closePanel} testID="bulk-unknown-close" />
    </View>
  );
}

const styles = StyleSheet.create({
  view: { gap: 14, paddingVertical: 8 },
  hero: { flexDirection: "row", alignItems: "center", gap: 10 },
  heroTitle: { flex: 1, fontSize: 21, fontWeight: "800" },
  lines: { gap: 6 },
  scroll: { flexGrow: 0, maxHeight: 280, borderRadius: R.md },
});
