import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { BottomSheet, MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { StateBlock } from "@/components/ui/StateBlock";
import { FieldLabel, InlineError, LineInput, Note, sheetStyles } from "@/components/engineering/workorder/sheetKit";
import type { Technician } from "@/lib/api/engineeringTeam";
import { resolveLoadState } from "@/lib/engineering/loadState";
import { filterTechnicians, needsRefreshAfter, technicianName } from "@/lib/engineering/teamModel";
import { useAssignTechnician } from "@/lib/engineering/useAssignTechnician";
import { useTechnicians } from "@/lib/engineering/useTeamOverview";
import { useTheme } from "@/lib/theme/useTheme";

export interface AssignTarget {
  id: string;
  /** "WO-1045" when the order has a number. */
  code: string | null;
  title: string;
  priority: string | null;
  /** Room number (or other place) the order is about, when the caller knows it. */
  location?: string | null;
  /** The assignee the manager is looking at (null = unassigned). Sent back so the server can detect a stale view. */
  assignedTo: string | null;
  assignedToName?: string | null;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  target: AssignTarget | null;
  scope: string | null;
  online: boolean;
  /** The server accepted the assignment (or it already was that person's). */
  onAssigned: (technician: Technician, changed: boolean) => void;
  /** The order changed under the manager: re-read it so the next try is made against the truth. */
  onNeedsRefresh?: () => void;
}

/**
 * Assign Technician. Only people the server lists as assignable engineers appear, with plain open-job counts: no
 * invented skills or availability. Success is shown only after the API accepts it.
 */
export function AssignTechnicianSheet({ visible, onClose, target, scope, online, onAssigned, onNeedsRefresh }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const techs = useTechnicians(scope, visible && online);
  const assign = useAssignTechnician(online);
  const { clearFailure } = assign;
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!visible) {
      setQuery("");
      setSelectedId(null);
      setNote("");
      clearFailure();
    }
  }, [visible, target?.id, clearFailure]);

  const list = useMemo(() => filterTechnicians(techs.data ?? [], query), [techs.data, query]);
  const selected = (techs.data ?? []).find((tech) => tech.user_id === selectedId) ?? null;
  const reassigning = target?.assignedTo != null;
  const state = resolveLoadState({ loading: techs.loading, failure: techs.failure, count: techs.data?.length ?? 0, offline: !online });

  async function confirm() {
    if (!target || !selected) return;
    const result = await assign.submit({
      workOrderId: target.id,
      assignedTo: selected.user_id,
      expectedAssignedTo: target.assignedTo,
      note: reassigning ? note : undefined,
    });
    if (result) {
      onAssigned(selected, result.changed);
      onClose();
    }
  }

  // A stale view (someone else assigned it first, or it closed) needs a fresh read before another attempt.
  useEffect(() => {
    if (assign.failure && needsRefreshAfter(assign.failure)) onNeedsRefresh?.();
  }, [assign.failure]);

  const failureText = assign.failure ? t(`engineeringTeam.assign.failure.${assign.failure}`) : null;

  return (
    <BottomSheet
      visible={visible}
      title={reassigning ? t("engineeringTeam.assign.reassignTitle") : t("engineeringTeam.assign.title")}
      onClose={onClose}
      tall
      testID="assign-sheet"
      footer={
        <Button
          label={reassigning ? t("engineeringTeam.assign.confirmReassign") : t("engineeringTeam.assign.confirm")}
          onPress={confirm}
          loading={assign.busy}
          disabled={!online || !selected || assign.busy || selected.user_id === target?.assignedTo}
          size="lg"
          testID="assign-confirm"
        />
      }
    >
      {target ? (
        <View style={sheetStyles.stack}>
          <View accessible accessibilityLabel={`${target.code ?? ""} ${target.title}`} style={styles.header}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.code, { color: theme.textMuted }]}>
              {[target.code, target.priority ? t(`workQueue.priority.${target.priority}`) : null, target.location ? t("workQueue.roomLabel", { room: target.location }) : null].filter(Boolean).join(" · ")}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.textPrimary }]} numberOfLines={3}>
              {target.title}
            </Text>
            {reassigning ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.current, { color: theme.textSecondary }]} testID="assign-current">
                {t("engineeringTeam.assign.currentlyWith", { name: target.assignedToName || t("workQueue.assignedUnknown") })}
              </Text>
            ) : null}
          </View>

          {!online ? <Note>{t("engineeringTeam.assign.needsConnection")}</Note> : null}

          <FieldLabel>{t("engineeringTeam.assign.search")}</FieldLabel>
          <LineInput
            value={query}
            onChangeText={setQuery}
            placeholder={t("engineeringTeam.assign.searchPlaceholder")}
            accessibilityLabel={t("engineeringTeam.assign.search")}
            autoCorrect={false}
            testID="assign-search"
          />

          {state.status === "ready" ? (
            list.length === 0 ? (
              <Text style={{ color: theme.textMuted }} testID="assign-no-match">
                {t("engineeringTeam.assign.noMatch")}
              </Text>
            ) : (
              <View style={styles.list} accessibilityRole="radiogroup">
                {list.map((tech) => {
                  const isCurrent = tech.user_id === target.assignedTo;
                  const isSelected = tech.user_id === selectedId;
                  const name = technicianName(tech, t("engineeringTeam.technician"));
                  const load = [
                    t("engineeringTeam.load.active", { count: tech.active }),
                    tech.urgent > 0 ? t("engineeringTeam.load.urgent", { count: tech.urgent }) : null,
                    tech.on_hold > 0 ? t("engineeringTeam.load.onHold", { count: tech.on_hold }) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <Pressable
                      key={tech.user_id}
                      onPress={() => !isCurrent && setSelectedId(tech.user_id)}
                      disabled={isCurrent}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: isSelected, disabled: isCurrent }}
                      accessibilityLabel={`${name}. ${load}${isCurrent ? `. ${t("engineeringTeam.assign.alreadyAssigned")}` : ""}`}
                      testID={`assign-tech-${tech.user_id}`}
                      style={[
                        styles.row,
                        {
                          backgroundColor: isSelected ? theme.primarySoft : theme.surfaceSubtle,
                          borderColor: isSelected ? theme.primaryLine : theme.border,
                          opacity: isCurrent ? 0.55 : 1,
                        },
                      ]}
                    >
                      <View style={styles.rowText}>
                        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.name, { color: theme.textPrimary }]}>
                          {name}
                        </Text>
                        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.load, { color: theme.textMuted }]}>
                          {isCurrent ? t("engineeringTeam.assign.alreadyAssigned") : load}
                        </Text>
                      </View>
                      <Ionicons name={isSelected ? "radio-button-on" : "radio-button-off"} size={22} color={isSelected ? theme.primaryAction : theme.textDisabled} />
                    </Pressable>
                  );
                })}
              </View>
            )
          ) : online ? (
            <StateBlock
              status={state.status === "loading" ? "loading" : state.status === "empty" ? "empty" : "error"}
              emptyTitle={t("engineeringTeam.assign.noTechnicians")}
              errorMessage={t("engineeringState.loadFailed")}
              onRetry={() => void techs.reload()}
              retryLabel={t("common.retry")}
            />
          ) : null}

          {reassigning && selected ? (
            <>
              <FieldLabel>{t("engineeringTeam.assign.noteLabel")}</FieldLabel>
              <LineInput
                value={note}
                onChangeText={setNote}
                placeholder={t("engineeringTeam.assign.notePlaceholder")}
                maxLength={500}
                accessibilityLabel={t("engineeringTeam.assign.noteLabel")}
                testID="assign-note"
              />
            </>
          ) : null}

          {failureText ? <InlineError testID="assign-error">{failureText}</InlineError> : null}
        </View>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  header: { gap: 2 },
  code: { fontSize: 12, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase" },
  title: { fontSize: 17, fontWeight: "800", lineHeight: 23 },
  current: { fontSize: 13.5, marginTop: 2 },
  list: { gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontSize: 15, fontWeight: "700" },
  load: { fontSize: 12.5 },
});
