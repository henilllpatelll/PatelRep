import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { BottomSheet, MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { FieldLabel, InlineError, LineInput, Note, sheetStyles } from "@/components/engineering/workorder/sheetKit";
import { assignPmSchedule, listPmTechnicians, type PmProgram, type PmTechnician } from "@/lib/api/pmManagement";
import { classifyManagementFailure, type ManagementFailure } from "@/lib/engineering/pmManagement";
import { formatDayYear } from "@/lib/engineering/assetFormat";
import { useTheme } from "@/lib/theme/useTheme";

export interface AssignTarget {
  id: string;
  name: string;
  assetName: string | null;
  location: string | null;
  dueAt: string | null;
  estimatedMinutes: number | null;
  /** The current (non-lapsed) assignee the manager is looking at; null when unassigned. */
  assigneeId: string | null;
  assigneeName: string | null;
  /** The version the manager saw. A newer one on the server refuses the write instead of overwriting it. */
  rowVersion: number;
}

interface Props {
  visible: boolean;
  target: AssignTarget | null;
  timezone: string | null | undefined;
  language: string;
  isOnline: boolean;
  onClose: () => void;
  /** The server confirmed the change; `program` is its answer. */
  onAssigned: (program: PmProgram, action: "assigned" | "reassigned" | "unassigned") => void;
  /** The schedule changed under the manager: re-read it so the next try is made against the truth. */
  onNeedsRefresh?: () => void;
}

/**
 * Assign Inspection. Only active engineers of this property are offered (the server decides), and the assignment applies
 * to THIS inspection - the schedule's current due date - not to every future one. Success is shown after the API accepts.
 */
export function AssignInspectionSheet({ visible, target, timezone, language, isOnline, onClose, onAssigned, onNeedsRefresh }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [technicians, setTechnicians] = useState<PmTechnician[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ManagementFailure | null>(null);
  const working = useRef(false);

  useEffect(() => {
    if (!visible) return;
    setQuery("");
    setSelectedId(null);
    setFailure(null);
    if (!isOnline) return;
    let live = true;
    setLoadFailed(false);
    listPmTechnicians()
      .then((rows) => live && setTechnicians(rows))
      .catch(() => live && setLoadFailed(true));
    return () => {
      live = false;
    };
  }, [visible, target?.id, isOnline]);

  const list = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (technicians ?? []).filter((tech) => !needle || (tech.name ?? "").toLowerCase().includes(needle));
  }, [technicians, query]);

  const reassigning = target?.assigneeId != null;

  const submit = async (assigneeId: string | null) => {
    if (!target || working.current) return;
    working.current = true;
    setBusy(true);
    setFailure(null);
    try {
      const program = await assignPmSchedule(target.id, assigneeId, target.rowVersion);
      onAssigned(program, assigneeId == null ? "unassigned" : reassigning ? "reassigned" : "assigned");
      onClose();
    } catch (err) {
      const classified = classifyManagementFailure(err);
      setFailure(classified);
      if (classified.kind === "version_conflict" || classified.kind === "schedule_inactive") onNeedsRefresh?.();
    } finally {
      working.current = false;
      setBusy(false);
    }
  };

  const due = target?.dueAt ? formatDayYear(target.dueAt, timezone, language) : null;
  const meta = [target?.assetName, target?.location, due ? t("pmMgmt.assign.due", { date: due }) : null, target?.estimatedMinutes ? t("pmMgmt.assign.estimate", { minutes: target.estimatedMinutes }) : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <BottomSheet
      visible={visible}
      title={t("pmMgmt.assign.title")}
      onClose={busy ? () => undefined : onClose}
      tall
      testID="pm-assign-sheet"
      footer={
        <Button
          label={reassigning ? t("pmMgmt.assign.confirmReassign") : t("pmMgmt.assign.confirm")}
          onPress={() => void submit(selectedId)}
          loading={busy}
          disabled={!isOnline || !selectedId || busy || selectedId === target?.assigneeId}
          size="lg"
          testID="pm-assign-confirm"
        />
      }
    >
      {target ? (
        <View style={sheetStyles.stack}>
          <View accessible accessibilityLabel={`${target.name}. ${meta}`}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.textPrimary }]} numberOfLines={3}>
              {target.name}
            </Text>
            {meta ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textSecondary }]}>
                {meta}
              </Text>
            ) : null}
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textSecondary }]} testID="pm-assign-current">
              {target.assigneeId ? t("pmMgmt.assign.currentlyWith", { name: target.assigneeName || t("pmMgmt.assign.unknownPerson") }) : t("pmMgmt.assign.unassigned")}
            </Text>
          </View>

          <Note>{t("pmMgmt.assign.scopeNote")}</Note>
          {!isOnline ? <Note tone="warn">{t("pmMgmt.needsConnection")}</Note> : null}

          <FieldLabel>{t("pmMgmt.assign.search")}</FieldLabel>
          <LineInput value={query} onChangeText={setQuery} placeholder={t("pmMgmt.assign.searchPlaceholder")} accessibilityLabel={t("pmMgmt.assign.search")} autoCorrect={false} testID="pm-assign-search" />

          {loadFailed ? (
            <InlineError testID="pm-assign-load-error">{t("pmMgmt.assign.loadFailed")}</InlineError>
          ) : technicians == null ? (
            <Text style={{ color: theme.textMuted }}>{t("pmMgmt.loading")}</Text>
          ) : list.length === 0 ? (
            <Text style={{ color: theme.textMuted }} testID="pm-assign-no-match">
              {t("pmMgmt.assign.noMatch")}
            </Text>
          ) : (
            <View style={styles.list} accessibilityRole="radiogroup">
              {list.map((tech) => {
                const isCurrent = tech.id === target.assigneeId;
                const isSelected = tech.id === selectedId;
                const name = tech.name || t("pmMgmt.assign.unknownPerson");
                return (
                  <Pressable
                    key={tech.id}
                    onPress={() => !isCurrent && setSelectedId(tech.id)}
                    disabled={isCurrent}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: isSelected, disabled: isCurrent }}
                    accessibilityLabel={isCurrent ? `${name}. ${t("pmMgmt.assign.alreadyAssigned")}` : name}
                    testID={`pm-assign-tech-${tech.id}`}
                    style={[styles.row, { backgroundColor: isSelected ? theme.primarySoft : theme.surfaceSubtle, borderColor: isSelected ? theme.primaryLine : theme.border, opacity: isCurrent ? 0.55 : 1 }]}
                  >
                    <View style={styles.rowText}>
                      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.name, { color: theme.textPrimary }]} numberOfLines={1}>
                        {name}
                      </Text>
                      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textMuted }]}>
                        {tech.role === "chief_engineer" ? t("pmMgmt.assign.roleChief") : t("pmMgmt.assign.roleEngineer")}
                        {isCurrent ? ` · ${t("pmMgmt.assign.alreadyAssigned")}` : ""}
                      </Text>
                    </View>
                    {isSelected ? <Ionicons name="checkmark-circle" size={22} color={theme.primary} /> : null}
                  </Pressable>
                );
              })}
            </View>
          )}

          {reassigning ? (
            <Button label={t("pmMgmt.assign.unassign")} variant="ghost" onPress={() => void submit(null)} disabled={!isOnline || busy} testID="pm-assign-unassign" />
          ) : null}
          {failure ? <InlineError testID="pm-assign-error">{t(`pmMgmt.failure.${failure.kind}`)}</InlineError> : null}
        </View>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 17, fontWeight: "700", lineHeight: 23 },
  meta: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  list: { gap: 8 },
  row: { minHeight: 56, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 10 },
  rowText: { flex: 1 },
  name: { fontSize: 15, fontWeight: "600" },
});
