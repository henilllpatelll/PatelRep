import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { Button } from "@/components/ui/Button";
import { WorkspaceSheet } from "@/components/supervisor/inspect/workspace/WorkspaceSheet";
import { fetchCorrectionOwners, type CorrectionOwner } from "@/lib/api/inspections";
import type { ActionFailure } from "@/lib/inspections/correctionActions";
import type { Translate } from "@/lib/inspections/viewText";
import { useTheme } from "@/lib/theme/useTheme";

type State = { status: "loading" } | { status: "failed" } | { status: "ready"; owners: CorrectionOwner[] };

/**
 * Pick who owns a correction. The list is the server's own list of eligible people in THIS hotel (the same one it
 * enforces when assigning), by stable id. Choosing someone changes nothing until "Assign" is pressed and the server
 * accepts it; a refusal is explained and the list stays as it was.
 */
export function ReassignSheet({
  roomNumber,
  open,
  currentOwnerId,
  busy,
  failure,
  t,
  onAssign,
  onClose,
}: {
  roomNumber: string;
  open: boolean;
  /** The owner the supervisor saw, or null. */
  currentOwnerId: string | null;
  busy: boolean;
  failure: ActionFailure | null;
  t: Translate;
  onAssign: (ownerId: string) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [state, setState] = useState<State>({ status: "loading" });
  const [choice, setChoice] = useState<string | null>(null);
  const live = useRef(false);

  const load = useCallback(() => {
    setState({ status: "loading" });
    Promise.resolve()
      .then(() => fetchCorrectionOwners())
      .then(
      (owners) => live.current && setState(Array.isArray(owners) ? { status: "ready", owners } : { status: "failed" }),
      () => live.current && setState({ status: "failed" }),
    );
  }, []);

  useEffect(() => {
    live.current = open;
    if (open) {
      setChoice(null);
      load();
    }
    return () => {
      live.current = false;
    };
  }, [open, load]);

  const owners = state.status === "ready" ? state.owners : [];
  return (
    <WorkspaceSheet visible={open} title={t("inspect.reassign.title", { room: roomNumber })} onClose={onClose} onBackdrop={busy ? undefined : onClose} closeLabel={t("inspect.record.close")} testID="reassign-sheet" t={t}>
      <View style={styles.body}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textSecondary }]}>
          {t("inspect.reassign.intro")}
        </Text>
        {state.status === "loading" ? (
          <View style={styles.inline} accessibilityRole="progressbar" accessibilityLabel={t("inspect.reassign.loading")}>
            <ActivityIndicator color={theme.primaryAction} />
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textMuted }]}>
              {t("inspect.reassign.loading")}
            </Text>
          </View>
        ) : state.status === "failed" ? (
          <View style={styles.block} accessibilityRole="alert">
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.status.dirty }]}>
              {t("inspect.reassign.failed")}
            </Text>
            <Button label={t("inspect.record.retry")} variant="secondary" size="sm" onPress={load} testID="reassign-retry" />
          </View>
        ) : owners.length === 0 ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textMuted }]} testID="reassign-empty">
            {t("inspect.reassign.empty")}
          </Text>
        ) : (
          <View style={styles.list} accessibilityRole="radiogroup">
            {owners.map((owner) => {
              const current = owner.id === currentOwnerId;
              const selected = owner.id === choice;
              return (
                <Pressable
                  key={owner.id}
                  onPress={() => setChoice(owner.id)}
                  disabled={busy}
                  accessibilityRole="radio"
                  accessibilityState={{ selected, disabled: busy }}
                  accessibilityLabel={`${owner.name}${owner.role ? `, ${t(`inspect.reassign.role.${owner.role}`)}` : ""}${current ? `, ${t("inspect.reassign.current")}` : ""}`}
                  testID={`reassign-owner-${owner.id}`}
                  style={[styles.option, { borderColor: selected ? theme.primaryAction : theme.border, backgroundColor: selected ? theme.primarySoft : theme.surface }]}
                >
                  <View style={styles.flex}>
                    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.name, { color: theme.textPrimary }]}>
                      {owner.name}
                    </Text>
                    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.muted, { color: theme.textMuted }]}>
                      {owner.role === "housekeeping_supervisor" || owner.role === "housekeeper" ? t(`inspect.reassign.role.${owner.role}`) : ""}
                      {current ? `${owner.role ? " · " : ""}${t("inspect.reassign.current")}` : ""}
                    </Text>
                  </View>
                  <Ionicons name={selected ? "radio-button-on" : "radio-button-off"} size={22} color={selected ? theme.primaryAction : theme.textMuted} />
                </Pressable>
              );
            })}
          </View>
        )}
        {failure ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="alert" style={[styles.error, { color: theme.status.dirty }]} testID="reassign-error">
            {t(`inspect.drawer.failure.${failure}`)}
          </Text>
        ) : null}
        <View style={styles.actions}>
          <Button label={t("inspect.reassign.assign")} size="lg" loading={busy} disabled={choice === null || choice === currentOwnerId} onPress={() => choice && onAssign(choice)} testID="reassign-confirm" />
          <Button label={t("common.cancel")} variant="secondary" size="lg" disabled={busy} onPress={onClose} testID="reassign-cancel" />
        </View>
      </View>
    </WorkspaceSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 12, paddingBottom: 8 },
  flex: { flex: 1, minWidth: 0 },
  inline: { flexDirection: "row", alignItems: "center", gap: 8 },
  block: { gap: 8 },
  list: { gap: 8 },
  option: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: R.md, paddingHorizontal: 14, paddingVertical: 10 },
  name: { fontSize: 16, lineHeight: 22, fontWeight: "800" },
  muted: { fontSize: 13.5, lineHeight: 19, fontWeight: "600" },
  error: { fontSize: 14, lineHeight: 20, fontWeight: "700" },
  actions: { gap: 8 },
});
