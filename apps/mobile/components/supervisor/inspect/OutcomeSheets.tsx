import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { R } from "@/components/shared/tokens";
import { Button } from "@/components/ui/Button";
import type { ReadyRoom } from "@/lib/api/inspections";
import type { ChecklistTemplate } from "@/lib/inspections/types";
import { useTheme } from "@/lib/theme/useTheme";
import type { InspectionOutcome } from "@/components/supervisor/inspect/InspectQueueCard";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/* The existing room-specific outcome flow (confirm sheet + re-clean sheet), moved out of the screen unchanged so the
   redesigned list stays small. Phase 3 replaces it with the full-screen checklist; nothing here is new behaviour. */
export function OutcomeSheets({
  confirm,
  template,
  notes,
  failedItems,
  submitting,
  reclean,
  recleaning,
  t,
  onNotes,
  onToggleItem,
  onConfirm,
  onCancel,
  onRecleanConfirm,
  onRecleanCancel,
}: {
  confirm: { room: ReadyRoom; result: InspectionOutcome } | null;
  template: ChecklistTemplate | undefined;
  notes: string;
  failedItems: Record<string, boolean>;
  submitting: boolean;
  reclean: { room: ReadyRoom; inspectionId: string; notes: string } | null;
  recleaning: boolean;
  t: Translate;
  onNotes: (text: string) => void;
  onToggleItem: (id: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  onRecleanConfirm: () => void;
  onRecleanCancel: () => void;
}) {
  const theme = useTheme();
  const confirmForeground = confirm?.result === "failed" ? theme.onDestructive : theme.onPrimary;

  return (
    <>
      <Modal visible={!!reclean} animationType="slide" transparent onRequestClose={() => onRecleanCancel()}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => onRecleanCancel()}>
          <TouchableOpacity style={[styles.modalSheet, { backgroundColor: theme.background }]} activeOpacity={1}>
            <View style={[styles.grabber, { backgroundColor: theme.border }]} />
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>
                {t("inspect.reclean.title", { room: reclean?.room.room_number })}
              </Text>
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={() => onRecleanCancel()}
                accessibilityRole="button"
                accessibilityLabel={t("common.cancel")}
              >
                <Ionicons name="close" size={22} color={theme.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={[styles.modalBody, { color: theme.textSecondary }]}>
              {t("inspect.reclean.body", { housekeeper: reclean?.room.cleaned_by || "—" })}
            </Text>
            {reclean?.notes ? (
              <View style={[styles.recleanNotesCard, { backgroundColor: theme.status.dirtySoft }]}>
                <Text style={[styles.recleanNotesText, { color: theme.status.dirty }]}>{reclean.notes}</Text>
              </View>
            ) : null}
            <View style={styles.confirmRow}>
              <Button
                label={t("common.cancel")}
                onPress={() => onRecleanCancel()}
                variant="secondary"
                style={styles.cancelBtnFlex}
              />
              <Button
                label={recleaning ? t("inspect.reclean.sending") : t("inspect.reclean.confirm")}
                onPress={onRecleanConfirm}
                loading={recleaning}
                variant="destructive"
                style={styles.confirmBtnFlex}
              />
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal visible={!!confirm} animationType="slide" transparent onRequestClose={() => onCancel()}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.modalOverlay}>
          <ScrollView
            style={[styles.confirmModalSheet, { backgroundColor: theme.background }]}
            contentContainerStyle={styles.modalSheetContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <View style={[styles.grabber, { backgroundColor: theme.border }]} />
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>
                {confirm?.result === "passed"
                  ? t("inspect.modalTitlePass", { room: confirm?.room.room_number })
                  : confirm?.result === "conditional"
                    ? t("inspect.modalTitleTouchup", { room: confirm?.room.room_number })
                    : t("inspect.modalTitleFail", { room: confirm?.room.room_number })}
              </Text>
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={() => onCancel()}
                accessibilityRole="button"
                accessibilityLabel={t("common.cancel")}
              >
                <Ionicons name="close" size={22} color={theme.textMuted} />
              </TouchableOpacity>
            </View>

            {confirm?.result === "failed" && template?.items && template.items.length > 0 ? (
              <>
                <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>{t("inspect.failChecklistLabel")}</Text>
                <View style={styles.checklistWrap}>
                  {template.items.map((item) => {
                    const failed = Boolean(failedItems[item.id]);
                    return (
                      <TouchableOpacity
                        key={item.id}
                        style={styles.checklistRow}
                        onPress={() => onToggleItem(item.id)}
                        activeOpacity={0.8}
                        accessibilityRole="checkbox"
                        accessibilityLabel={item.description}
                        accessibilityState={{ checked: failed }}
                      >
                        <View
                          style={[
                            styles.checkBox,
                            { borderColor: theme.border, backgroundColor: theme.surfaceSubtle },
                            failed && { backgroundColor: theme.status.dirty, borderColor: theme.status.dirty },
                          ]}
                        >
                          {failed ? <Ionicons name="close" size={12} color={theme.onDestructive} /> : null}
                        </View>
                        <Text
                          style={[
                            styles.checklistLabel,
                            { color: theme.textPrimary },
                            failed && { color: theme.status.dirty, textDecorationLine: "line-through" },
                          ]}
                        >
                          {item.description}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            ) : null}
            <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>{t("inspect.notesOptional")}</Text>
            <TextInput
              style={[styles.notesInput, { backgroundColor: theme.surface, borderColor: theme.border, color: theme.textPrimary }]}
              placeholder={
                confirm?.result === "failed"
                  ? t("inspect.failNotesPlaceholder")
                  : t("inspect.passNotesPlaceholder")
              }
              placeholderTextColor={theme.textDisabled}
              value={notes}
              onChangeText={onNotes}
              multiline
              maxLength={500}
            />

            <View style={styles.confirmRow}>
              <Button
                label={t("common.cancel")}
                onPress={() => onCancel()}
                variant="secondary"
                style={styles.cancelBtnFlex}
              />
              {/* Tri-color pass/touchup/fail confirm action kept as a themed
                  TouchableOpacity rather than <Button> — Button's variant palette
                  (primary/secondary/ghost/destructive) has no amber/caution tone,
                  and force-fitting "conditional" onto "primary" would misleadingly
                  recolor a caution action forest-green. Mirrors the same queue
                  action buttons above and the 08-02 ChecklistSection precedent for
                  not force-fitting a status vocabulary onto a mismatched primitive. */}
              <TouchableOpacity
                style={[
                  styles.confirmBtn,
                  {
                    backgroundColor:
                      confirm?.result === "passed"
                        ? theme.status.ready
                        : confirm?.result === "conditional"
                          ? theme.status.pickup
                          : theme.status.dirty,
                  },
                  submitting && styles.dimmed,
                ]}
                onPress={onConfirm}
                disabled={submitting}
                accessibilityRole="button"
                accessibilityLabel={
                  confirm?.result === "passed"
                    ? t("inspect.confirmPass")
                    : confirm?.result === "conditional"
                      ? t("inspect.confirmTouchup")
                      : t("inspect.confirmFail")
                }
                accessibilityState={{ disabled: submitting, busy: submitting }}
              >
                <Text style={[styles.confirmText, { color: confirmForeground }]}>
                  {submitting
                    ? t("inspect.submitting")
                    : confirm?.result === "passed"
                      ? t("inspect.confirmPass")
                      : confirm?.result === "conditional"
                        ? t("inspect.confirmTouchup")
                        : t("inspect.confirmFail")}
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  modalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  modalSheet: { maxHeight: "90%", borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 20, paddingBottom: 40, paddingTop: 10 },
  confirmModalSheet: { maxHeight: "90%", borderTopLeftRadius: 22, borderTopRightRadius: 22 },
  modalSheetContent: { paddingHorizontal: 20, paddingBottom: 40, paddingTop: 10 },
  grabber: { alignSelf: "center", width: 38, height: 4, borderRadius: 2, marginBottom: 14 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 18 },
  modalTitle: { fontSize: 20, fontWeight: "700", flex: 1, marginRight: 12 },
  closeBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  fieldLabel: { fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 },
  notesInput: { borderWidth: 1, borderRadius: R.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, minHeight: 84, textAlignVertical: "top" },
  confirmRow: { flexDirection: "row", alignItems: "stretch", gap: 10, marginTop: 18 },
  cancelBtnFlex: { flex: 1 },
  confirmBtnFlex: { flex: 2 },
  confirmBtn: { flex: 2, minHeight: 48, borderRadius: R.md, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" },
  confirmText: { fontSize: 15, fontWeight: "700", textAlign: "center" },
  dimmed: { opacity: 0.5 },
  checklistWrap: { gap: 6, marginBottom: 12 },
  checklistRow: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 10 },
  checkBox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  checklistLabel: { fontSize: 13.5, flex: 1 },
  modalBody: { fontSize: 14, lineHeight: 20, marginBottom: 12 },
  recleanNotesCard: { borderRadius: 10, padding: 12, marginBottom: 12 },
  recleanNotesText: { fontSize: 12.5 },
});
