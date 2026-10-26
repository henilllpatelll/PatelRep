import type { ReactNode } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { Button } from "@/components/ui/Button";
import type { CarryOverPlan, SessionIssue, UnavailableReason } from "@/lib/inspections/workspace";
import type { Translate } from "@/lib/inspections/viewText";
import { useTheme } from "@/lib/theme/useTheme";

/* Everything the workspace says instead of a checklist: still opening, cannot be opened, was interrupted, or the
   checklist changed. Each names what happened and what is safe to do; none of them changes a room or loses a draft. */

function Panel({ icon, tone, title, body, testID, children }: { icon: "alert-circle-outline" | "swap-horizontal-outline" | "lock-closed-outline" | "cloud-offline-outline"; tone: "problem" | "info"; title: string; body: string; testID: string; children?: ReactNode }) {
  const theme = useTheme();
  const color = tone === "problem" ? theme.status.dirty : theme.status.clean;
  return (
    <View style={[styles.panel, { backgroundColor: theme.surface, borderColor: theme.border }]} accessibilityRole="alert" testID={testID}>
      <Ionicons name={icon} size={30} color={color} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]} testID={`${testID}-title`}>
        {title}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]} testID={`${testID}-body`}>
        {body}
      </Text>
      <View style={styles.actions}>{children}</View>
    </View>
  );
}

export function WorkspaceLoading({ t }: { t: Translate }) {
  const theme = useTheme();
  return (
    <View style={styles.loading} accessibilityRole="progressbar" accessibilityLabel={t("inspect.workspace.loading")} testID="workspace-loading">
      <ActivityIndicator color={theme.primaryAction} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
        {t("inspect.workspace.loading")}
      </Text>
    </View>
  );
}

const TEMPLATE_REASONS: readonly string[] = ["no_templates", "no_usable_template", "no_default", "room_type_unknown", "invalid_templates"];

export function UnavailableView({
  reason,
  t,
  onBack,
  onRetry,
  onContinueWithoutDraft,
}: {
  reason: UnavailableReason | "read_failed";
  t: Translate;
  onBack: () => void;
  onRetry: () => void;
  onContinueWithoutDraft: () => void;
}) {
  const retryable = reason === "queue_failed" || reason === "needs_connection" || reason === "templates_failed" || reason === "read_failed";
  const titleKey = TEMPLATE_REASONS.includes(reason) ? "inspect.workspace.unavailable.template.title" : `inspect.workspace.unavailable.${reason}.title`;
  const body = TEMPLATE_REASONS.includes(reason) ? t(`inspect.template.${reason}`) : t(`inspect.workspace.unavailable.${reason}.body`);
  return (
    <Panel
      icon={reason === "needs_connection" ? "cloud-offline-outline" : "alert-circle-outline"}
      tone="problem"
      title={t(titleKey)}
      body={body}
      testID="workspace-unavailable"
    >
      {retryable ? <Button label={t("inspect.workspace.retry")} onPress={onRetry} testID="workspace-unavailable-retry" /> : null}
      {reason === "read_failed" ? <Button label={t("inspect.workspace.unavailable.read_failed.continue")} variant="secondary" onPress={onContinueWithoutDraft} testID="workspace-unavailable-continue" /> : null}
      <Button label={t("inspect.workspace.backToQueue")} variant="secondary" onPress={onBack} testID="workspace-unavailable-back" />
    </Panel>
  );
}

export function BlockedView({ issue, room, t, onBack, onViewRoom }: { issue: SessionIssue; room: string; t: Translate; onBack: () => void; onViewRoom: () => void }) {
  return (
    <Panel
      icon="lock-closed-outline"
      tone="problem"
      title={t(`inspect.workspace.blocked.${issue}.title`, { room })}
      body={t(`inspect.workspace.blocked.${issue}.body`, { room })}
      testID="workspace-blocked"
    >
      <Button label={t("inspect.workspace.backToQueue")} onPress={onBack} testID="workspace-blocked-back" />
      <Button label={t("inspect.workspace.viewRoom")} variant="secondary" onPress={onViewRoom} testID="workspace-blocked-view" />
    </Panel>
  );
}

export function TemplateChangedView({
  plan,
  busy,
  t,
  onKeep,
  onStartOver,
  onBack,
}: {
  plan: CarryOverPlan;
  busy: boolean;
  t: Translate;
  onKeep: () => void;
  onStartOver: () => void;
  onBack: () => void;
}) {
  const theme = useTheme();
  return (
    <Panel
      icon="swap-horizontal-outline"
      tone="info"
      title={t("inspect.workspace.templateChanged.title")}
      body={t("inspect.workspace.templateChanged.body")}
      testID="workspace-template-changed"
    >
      <View style={[styles.facts, { borderColor: theme.border, backgroundColor: theme.surfaceMuted }]} testID="workspace-template-facts">
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.fact, { color: theme.textPrimary }]} testID="workspace-template-carried">
          {t("inspect.workspace.templateChanged.carried", { count: plan.carried })}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.fact, { color: theme.textPrimary }]} testID="workspace-template-dropped">
          {t("inspect.workspace.templateChanged.dropped", { count: plan.dropped })}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.fact, { color: theme.textPrimary }]} testID="workspace-template-needed">
          {t("inspect.workspace.templateChanged.needed", { count: plan.stillToAnswer })}
        </Text>
      </View>
      <Button label={t(plan.carried > 0 ? "inspect.workspace.templateChanged.keep" : "inspect.workspace.templateChanged.continue")} loading={busy} onPress={onKeep} testID="workspace-template-keep" />
      <Button label={t("inspect.workspace.resume.startOver")} variant="secondary" disabled={busy} onPress={onStartOver} testID="workspace-template-startover" />
      <Button label={t("inspect.workspace.backToQueue")} variant="ghost" disabled={busy} onPress={onBack} testID="workspace-template-back" />
    </Panel>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 },
  panel: { borderWidth: 1, borderRadius: R.lg, padding: 18, gap: 10, alignItems: "flex-start" },
  title: { fontSize: 20, lineHeight: 26, fontWeight: "800" },
  body: { fontSize: 15, lineHeight: 22, fontWeight: "600" },
  actions: { alignSelf: "stretch", gap: 8, marginTop: 6 },
  facts: { alignSelf: "stretch", borderWidth: 1, borderRadius: R.md, padding: 12, gap: 6 },
  fact: { fontSize: 14.5, lineHeight: 20, fontWeight: "700" },
});
