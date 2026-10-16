import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { SheetNotice } from "@/components/home/sheetParts";
import { DraftField, useSubmitGuard } from "@/components/supervisor/commsParts";
import { Button } from "@/components/ui/Button";
import { createShiftNote, fetchHotelDepartments } from "@/lib/api/housekeepingSupervisor";
import {
  SHIFT_NOTE_MAX,
  isMeaningfulDraft,
  resolveHousekeepingDepartment,
  type DepartmentResolution,
  type SendFailureKind,
} from "@/lib/housekeeping/supervisorComms";
import { useDiscardGuard } from "@/lib/housekeeping/useDiscardGuard";
import { useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";

interface Props {
  visible: boolean;
  /** The hotel the note belongs to; its departments are read to find Housekeeping. */
  tenantId: string | null;
  isOnline: boolean;
  onClose: () => void;
}

type DepartmentState = { status: "loading" } | { status: "failed" } | DepartmentResolution;

/**
 * Add a shift note: one informational logbook entry in the hotel's Housekeeping department
 * (POST /logbook/entries). The department is looked up from the hotel's own list and never guessed:
 * with no single clear Housekeeping department the note cannot be filed, and the sheet says why.
 * A sheet that is not showing holds nothing, so a draft never outlives its sheet.
 */
export default function ShiftNoteModal({ visible, tenantId, isOnline, onClose }: Props) {
  if (!visible) return null;
  return <ShiftNoteSheet tenantId={tenantId} isOnline={isOnline} onClose={onClose} />;
}

function ShiftNoteSheet({ tenantId, isOnline, onClose }: Omit<Props, "visible">) {
  const { t } = useTranslation();
  const theme = useTheme();
  const toast = useToast();
  const { busy, run } = useSubmitGuard();
  const [text, setText] = useState("");
  const [failure, setFailure] = useState<SendFailureKind | null>(null);
  const [department, setDepartment] = useState<DepartmentState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setDepartment({ status: "loading" });
    if (!tenantId) {
      setDepartment({ status: "failed" });
      return;
    }
    fetchHotelDepartments(tenantId).then(
      (rows) => {
        if (!cancelled) setDepartment(resolveHousekeepingDepartment(rows));
      },
      () => {
        if (!cancelled) setDepartment({ status: "failed" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [tenantId, attempt]);

  const dirty = isMeaningfulDraft(text);
  const requestClose = useDiscardGuard({ dirty, busy, onClose });
  const departmentId = department.status === "ok" ? department.departmentId : null;
  const canSave = dirty && departmentId !== null && isOnline && !busy;

  const save = useCallback(async () => {
    if (!dirty || !departmentId || !isOnline) return;
    setFailure(null);
    const result = await run(() => createShiftNote(departmentId, text));
    if (!result) return; // a second tap while the first is in flight
    if (result.ok) {
      toast.success(t("supervisorComms.note.saved"));
      onClose();
    } else {
      setFailure(result.kind);
    }
  }, [dirty, departmentId, isOnline, run, text, toast, t, onClose]);

  const departmentNotice =
    department.status === "failed"
      ? t("supervisorComms.note.departmentFailed")
      : department.status === "missing"
        ? t("supervisorComms.note.departmentMissing")
        : department.status === "ambiguous"
          ? t("supervisorComms.note.departmentAmbiguous")
          : null;

  return (
    <BottomSheet
      visible
      title={t("supervisorComms.note.title")}
      onClose={requestClose}
      grabber
      testID="shift-note-sheet"
      footer={
        <View style={styles.footer}>
          <Button
            label={t("common.cancel")}
            onPress={requestClose}
            variant="secondary"
            disabled={busy}
            style={styles.cancel}
            testID="shift-note-cancel"
          />
          <Button
            label={t("supervisorComms.note.save")}
            onPress={save}
            loading={busy}
            disabled={!canSave}
            icon="checkmark-circle-outline"
            style={styles.primary}
            testID="shift-note-save"
          />
        </View>
      }
    >
      <View style={styles.body}>
        <View style={styles.intro}>
          <Ionicons name="book-outline" size={20} color={theme.status.clean} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sub, { color: theme.textSecondary }]}>
            {t("supervisorComms.note.sub")}
          </Text>
        </View>

        <DraftField
          testID="shift-note-input"
          label={t("supervisorComms.note.label")}
          value={text}
          onChangeText={setText}
          placeholder={t("supervisorComms.note.placeholder")}
          max={SHIFT_NOTE_MAX}
          counterText={t("supervisorComms.count", { count: text.trim().length, max: SHIFT_NOTE_MAX })}
          minHeight={140}
          editable={!busy}
          autoFocus
        />

        {department.status === "ok" ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textMuted }]} testID="shift-note-department">
            {t("supervisorComms.note.department", { department: t("supervisorComms.note.departmentName") })}
          </Text>
        ) : department.status === "loading" ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textMuted }]} testID="shift-note-department-loading">
            {t("supervisorComms.note.departmentLoading")}
          </Text>
        ) : null}

        {departmentNotice ? (
          <View style={styles.stack}>
            <SheetNotice text={departmentNotice} tone="warn" testID="shift-note-department-notice" />
            {department.status === "failed" ? (
              <Button
                label={t("supervisorComms.retry")}
                onPress={() => setAttempt((n) => n + 1)}
                variant="secondary"
                size="sm"
                testID="shift-note-department-retry"
              />
            ) : null}
          </View>
        ) : null}

        {!isOnline ? <SheetNotice text={t("supervisorComms.offline")} tone="warn" testID="shift-note-offline" /> : null}
        {failure ? <SheetNotice text={t(`supervisorComms.errors.${failure}`)} tone="error" testID="shift-note-error" /> : null}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 14 },
  intro: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  sub: { flex: 1, fontSize: 14, lineHeight: 20 },
  meta: { fontSize: 13, fontWeight: "600" },
  stack: { gap: 8 },
  footer: { flexDirection: "row", gap: 10 },
  cancel: { flex: 1 },
  primary: { flex: 2 },
});
