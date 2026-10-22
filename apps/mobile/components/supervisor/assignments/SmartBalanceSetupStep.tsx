import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { Body, Notice, SectionLabel } from "@/components/supervisor/assignments/BulkParts";
import { ScopeRow, SheetHeader, ToggleRow } from "@/components/supervisor/assignments/SmartBalanceParts";
import { Button } from "@/components/ui/Button";
import { blockedText, failureText } from "@/lib/housekeeping/smartBalanceText";
import type { SmartScope } from "@/lib/housekeeping/smartBalancePool";
import type { SmartBalanceController } from "@/lib/housekeeping/useSmartBalance";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

const SCOPES: SmartScope[] = ["unassigned", "all_unstarted", "selected"];

/* ─── Setup: what to balance, and how ───────────────────────────────────────
   Nothing is generated until the supervisor taps "Generate preview". The four switches are this run's choices only
   (they start from the property's stored settings and are never saved back); "Protect cleaning already started" is a
   rule, shown locked. When the board, the roster or the connection cannot support a plan, the reason is stated here and
   the button is off - a plan is never made from data that was not verified. */

export function SmartBalanceSetupStep({ smart, onRefresh, t }: { smart: SmartBalanceController; onRefresh: () => void; t: Translate }) {
  const theme = useTheme();
  const { scope, toggles, setup, generation } = smart;
  const loading = generation.kind === "loading";
  const blocked = setup.blocked;
  // A data problem (as opposed to "nothing to plan") offers a refresh.
  const dataProblem = blocked === "board_unavailable" || blocked === "not_live" || blocked === "staff_unavailable" || blocked === "attendance_unavailable";
  const selectedEmpty = setup.selectedCount === 0;

  return (
    <>
      <SheetHeader title={t("assignments.v2.smart.setup.title")} onClose={smart.close} closeLabel={t("assignments.v2.smart.setup.close")} testID="smart-setup" />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID="smart-setup-scroll">
        <Body tone="secondary">{t("assignments.v2.smart.setup.intro")}</Body>

        <SectionLabel>{t("assignments.v2.smart.setup.scopeTitle")}</SectionLabel>
        {SCOPES.map((option) => {
          const base = `assignments.v2.smart.setup.scope.${option}`;
          const disabled = option === "selected" && selectedEmpty;
          const hint = option === "selected" ? (selectedEmpty ? t(`${base}.none`) : `${t(`${base}.hint`)} ${t(`${base}.count`, { count: setup.selectedCount })}`) : t(`${base}.hint`);
          return (
            <ScopeRow
              key={option}
              label={t(`${base}.label`)}
              hint={hint}
              warning={option === "all_unstarted" ? t(`${base}.warning`) : null}
              selected={scope === option}
              disabled={disabled}
              onPress={() => smart.setScope(option)}
              testID={`smart-scope-${option}`}
            />
          );
        })}

        <SectionLabel>{t("assignments.v2.smart.setup.prefsTitle")}</SectionLabel>
        <Body tone="muted" testID="smart-prefs-source">
          {t(`assignments.v2.smart.setup.prefsSource.${smart.preferencesSource}`)}
        </Body>
        <ToggleRow label={t("assignments.v2.smart.setup.pref.balanceWorkload")} checked={toggles.balanceWorkload} onPress={() => smart.toggle("balanceWorkload")} testID="smart-pref-balanceWorkload" />
        <ToggleRow label={t("assignments.v2.smart.setup.pref.prioritizeDeadlines")} checked={toggles.prioritizeDeadlines} onPress={() => smart.toggle("prioritizeDeadlines")} testID="smart-pref-prioritizeDeadlines" />
        <ToggleRow label={t("assignments.v2.smart.setup.pref.preferNearby")} checked={toggles.preferNearby} onPress={() => smart.toggle("preferNearby")} testID="smart-pref-preferNearby" />
        <ToggleRow label={t("assignments.v2.smart.setup.pref.minimizeReassignment")} checked={toggles.minimizeReassignment} onPress={() => smart.toggle("minimizeReassignment")} testID="smart-pref-minimizeReassignment" />
        <ToggleRow label={t("assignments.v2.smart.setup.pref.protectStarted")} checked locked lockedLabel={t("assignments.v2.smart.setup.pref.always")} testID="smart-pref-protectStarted" />
        <Body tone="muted">{t("assignments.v2.smart.setup.staffRule")}</Body>

        {blocked ? (
          <Notice icon="alert-circle-outline" tone="alert" testID="smart-setup-blocked" live>
            {blockedText(blocked, t)}
          </Notice>
        ) : (
          <View style={styles.preflight} testID="smart-preflight">
            <Body strong>{t("assignments.v2.smart.setup.preflight.rooms", { count: setup.rooms })}</Body>
            <Body tone="secondary">{t("assignments.v2.smart.setup.preflight.people", { count: setup.people })}</Body>
            {setup.heldBack > 0 ? <Body tone="secondary">{t("assignments.v2.smart.setup.preflight.heldBack", { count: setup.heldBack })}</Body> : null}
          </View>
        )}
        {generation.kind === "failed" ? (
          <Notice icon="alert-circle-outline" tone="alert" testID="smart-setup-failed" live>
            {failureText(generation.failure, t)}
          </Notice>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        {loading ? (
          <View style={styles.loading} accessibilityLiveRegion="polite" testID="smart-generating">
            <ActivityIndicator color={theme.primaryAction} />
            <Body tone="secondary">{t("assignments.v2.smart.setup.generating")}</Body>
          </View>
        ) : dataProblem ? (
          <Button label={t("assignments.v2.smart.setup.refresh")} icon="refresh-outline" onPress={onRefresh} testID="smart-refresh" />
        ) : (
          <Button
            label={generation.kind === "failed" ? t("assignments.v2.smart.setup.retry") : t("assignments.v2.smart.setup.generate")}
            icon="sparkles-outline"
            onPress={() => void smart.generate()}
            disabled={blocked !== null || (scope === "selected" && selectedEmpty)}
            testID="smart-generate"
          />
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0, marginTop: 8 },
  content: { gap: 10, paddingBottom: 12 },
  preflight: { gap: 2 },
  footer: { paddingTop: 8 },
  loading: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, minHeight: 48 },
});
