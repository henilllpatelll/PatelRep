import { StyleSheet, Text, View } from "react-native";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { Button } from "@/components/ui/Button";
import { WorkspaceSheet } from "@/components/supervisor/inspect/workspace/WorkspaceSheet";
import type { Translate } from "@/lib/inspections/viewText";
import { useTheme } from "@/lib/theme/useTheme";

/* The four small drawers about the supervisor's draft. Each is a question with explicit answers; none dismisses
   itself on a backdrop tap while a write is running, and none loses what has been entered. */

function Lines({ lines }: { lines: string[] }) {
  const theme = useTheme();
  return (
    <View style={styles.lines}>
      {lines.map((line, index) => (
        <Text key={line} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[index === 0 ? styles.primary : styles.secondary, { color: index === 0 ? theme.textPrimary : theme.textSecondary }]}>
          {line}
        </Text>
      ))}
    </View>
  );
}

/** Leaving an unfinished inspection. */
export function SaveExitSheet({
  visible,
  room,
  reviewed,
  failed,
  busy,
  t,
  onKeep,
  onSave,
  onDiscard,
  onExitUnsaved,
}: {
  visible: boolean;
  room: string;
  /** "7 of 12 items reviewed" */
  reviewed: string;
  /** The last save attempt failed: say so, and offer the honest ways out. */
  failed: boolean;
  busy: boolean;
  t: Translate;
  onKeep: () => void;
  onSave: () => void;
  onDiscard: () => void;
  onExitUnsaved: () => void;
}) {
  const theme = useTheme();
  return (
    <WorkspaceSheet
      visible={visible}
      title={t("inspect.workspace.saveExit.title")}
      onClose={busy ? () => undefined : onKeep}
      onBackdrop={busy ? undefined : onKeep}
      closeLabel={t("inspect.workspace.saveExit.keep")}
      showClose={false}
      testID="workspace-saveexit"
      t={t}
      footer={
        <>
          <Button label={t("inspect.workspace.saveExit.save")} size="lg" loading={busy} onPress={onSave} testID="workspace-saveexit-save" />
          <Button label={t("inspect.workspace.saveExit.keep")} variant="secondary" size="lg" disabled={busy} onPress={onKeep} testID="workspace-saveexit-keep" />
          {failed ? <Button label={t("inspect.workspace.saveExit.exitUnsaved")} variant="ghost" disabled={busy} onPress={onExitUnsaved} testID="workspace-saveexit-unsaved" /> : null}
          <Button label={t("inspect.workspace.saveExit.discard")} variant="ghost" disabled={busy} onPress={onDiscard} testID="workspace-saveexit-discard" />
        </>
      }
    >
      <Lines lines={[t("inspect.workspace.saveExit.room", { room }), reviewed]} />
      {failed ? (
        <Text accessibilityRole="alert" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.error, { color: theme.status.dirty }]} testID="workspace-saveexit-error">
          {t("inspect.workspace.saveExit.failed")}
        </Text>
      ) : null}
    </WorkspaceSheet>
  );
}

/** A separate, destructive confirmation: discarding is never one tap away from a casual back press. */
export function DiscardSheet({
  visible,
  room,
  busy,
  failed,
  t,
  onKeep,
  onDiscard,
}: {
  visible: boolean;
  room: string;
  busy: boolean;
  failed: boolean;
  t: Translate;
  onKeep: () => void;
  onDiscard: () => void;
}) {
  const theme = useTheme();
  return (
    <WorkspaceSheet
      visible={visible}
      title={t("inspect.workspace.discard.title")}
      onClose={busy ? () => undefined : onKeep}
      onBackdrop={busy ? undefined : onKeep}
      closeLabel={t("inspect.workspace.discard.keep")}
      showClose={false}
      testID="workspace-discard"
      t={t}
      footer={
        <>
          <Button label={t("inspect.workspace.discard.keep")} variant="secondary" size="lg" disabled={busy} onPress={onKeep} testID="workspace-discard-keep" />
          <Button label={t("inspect.workspace.discard.confirm")} variant="destructive" size="lg" loading={busy} onPress={onDiscard} testID="workspace-discard-confirm" />
        </>
      }
    >
      <Lines lines={[t("inspect.workspace.discard.body", { room })]} />
      {failed ? (
        <Text accessibilityRole="alert" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.error, { color: theme.status.dirty }]} testID="workspace-discard-error">
          {t("inspect.workspace.discard.failed")}
        </Text>
      ) : null}
    </WorkspaceSheet>
  );
}

/** Offered when a valid unfinished draft exists. There is no backdrop dismissal: the choice is explicit. */
export function ResumeSheet({
  visible,
  room,
  reviewed,
  savedAt,
  busy,
  error,
  t,
  onResume,
  onStartOver,
  onLeave,
}: {
  visible: boolean;
  room: string;
  reviewed: string;
  /** "Last saved 11:57 AM", or null when the time cannot be shown. */
  savedAt: string | null;
  busy: boolean;
  error: boolean;
  t: Translate;
  onResume: () => void;
  onStartOver: () => void;
  /** Android back: leave without touching the draft. */
  onLeave: () => void;
}) {
  const theme = useTheme();
  return (
    <WorkspaceSheet
      visible={visible}
      title={t("inspect.workspace.resume.title")}
      onClose={busy ? () => undefined : onLeave}
      showClose={false}
      testID="workspace-resume"
      t={t}
      footer={
        <>
          <Button label={t("inspect.workspace.resume.resume")} size="lg" loading={busy} onPress={onResume} testID="workspace-resume-resume" />
          <Button label={t("inspect.workspace.resume.startOver")} variant="secondary" size="lg" disabled={busy} onPress={onStartOver} testID="workspace-resume-startover" />
        </>
      }
    >
      <Lines lines={[t("inspect.workspace.saveExit.room", { room }), reviewed, ...(savedAt ? [savedAt] : [])]} />
      {error ? (
        <Text accessibilityRole="alert" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.error, { color: theme.status.dirty }]} testID="workspace-resume-error">
          {t("inspect.workspace.resume.error")}
        </Text>
      ) : null}
    </WorkspaceSheet>
  );
}

/** Starting over deletes saved progress, so it asks first. */
export function StartOverSheet({
  visible,
  room,
  count,
  busy,
  failed,
  t,
  onKeep,
  onConfirm,
}: {
  visible: boolean;
  room: string;
  count: number;
  busy: boolean;
  failed: boolean;
  t: Translate;
  onKeep: () => void;
  onConfirm: () => void;
}) {
  const theme = useTheme();
  return (
    <WorkspaceSheet
      visible={visible}
      title={t("inspect.workspace.startOver.title")}
      onClose={busy ? () => undefined : onKeep}
      showClose={false}
      testID="workspace-startover"
      t={t}
      footer={
        <>
          <Button label={t("inspect.workspace.startOver.keep")} variant="secondary" size="lg" disabled={busy} onPress={onKeep} testID="workspace-startover-keep" />
          <Button label={t("inspect.workspace.startOver.confirm")} variant="destructive" size="lg" loading={busy} onPress={onConfirm} testID="workspace-startover-confirm" />
        </>
      }
    >
      <Lines lines={[t("inspect.workspace.startOver.body", { room, count })]} />
      {failed ? (
        <Text accessibilityRole="alert" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.error, { color: theme.status.dirty }]} testID="workspace-startover-error">
          {t("inspect.workspace.discard.failed")}
        </Text>
      ) : null}
    </WorkspaceSheet>
  );
}

const styles = StyleSheet.create({
  lines: { gap: 4 },
  primary: { fontSize: 17, lineHeight: 24, fontWeight: "800" },
  secondary: { fontSize: 15, lineHeight: 22, fontWeight: "600" },
  error: { fontSize: 14, lineHeight: 20, fontWeight: "700" },
});
