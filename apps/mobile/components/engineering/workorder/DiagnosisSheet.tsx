import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { useTheme } from "@/lib/theme/useTheme";
import type { DiagnosisPayload } from "@/lib/api/workOrders";
import { isOtherCode } from "@/lib/engineering/repairWorkspace";
import type { WorkOrder } from "@/lib/engineering/workOrders";
import { CodePicker, useRepairCodes } from "./CodePicker";
import { InlineError, Note, sheetStyles } from "./sheetKit";
import { useSheetSubmit } from "./useSheetSubmit";

interface Props {
  visible: boolean;
  onClose: () => void;
  online: boolean;
  wo: Pick<WorkOrder, "id" | "category" | "problem_code" | "cause_code" | "problem_other_text" | "cause_other_text">;
  onSave: (payload: DiagnosisPayload) => Promise<void>;
}

/**
 * Diagnosis is the API's problem + cause coding (PATCH /work-orders/{id}/diagnosis). It is a working diagnosis:
 * the verified outcome is recorded separately, at completion. The schema has no free-text findings field, so
 * observations go in a note.
 */
export function DiagnosisSheet({ visible, onClose, online, wo, onSave }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const state = useRepairCodes(wo.category ?? undefined, visible);
  const [problemId, setProblemId] = useState<string | null>(wo.problem_code?.id ?? null);
  const [causeId, setCauseId] = useState<string | null>(wo.cause_code?.id ?? null);
  const [problemOther, setProblemOther] = useState(wo.problem_other_text ?? "");
  const [causeOther, setCauseOther] = useState(wo.cause_other_text ?? "");
  const [showErrors, setShowErrors] = useState(false);
  const dirty = useRef(false);
  const { busy, error, run } = useSheetSubmit();

  // Adopt the saved diagnosis unless the person has unsaved edits in progress.
  useEffect(() => {
    if (dirty.current) return;
    setProblemId(wo.problem_code?.id ?? null);
    setCauseId(wo.cause_code?.id ?? null);
    setProblemOther(wo.problem_other_text ?? "");
    setCauseOther(wo.cause_other_text ?? "");
  }, [wo.problem_code?.id, wo.cause_code?.id, wo.problem_other_text, wo.cause_other_text]);

  const problem = state.codes.find((c) => c.id === problemId);
  const cause = state.codes.find((c) => c.id === causeId);
  const problemOtherMissing = isOtherCode(problem) && !problemOther.trim();
  const causeOtherMissing = isOtherCode(cause) && !causeOther.trim();
  const nothingChosen = !problemId && !causeId && !problemOther.trim() && !causeOther.trim();

  function edit<T>(setter: (v: T) => void) {
    return (value: T) => {
      dirty.current = true;
      setter(value);
    };
  }

  async function save() {
    setShowErrors(true);
    if (nothingChosen || problemOtherMissing || causeOtherMissing) return;
    const payload: DiagnosisPayload = {
      problem_code_id: problemId ?? undefined,
      cause_code_id: causeId ?? undefined,
      problem_other_text: isOtherCode(problem) ? problemOther.trim() : undefined,
      cause_other_text: isOtherCode(cause) ? causeOther.trim() : undefined,
    };
    const ok = await run(() => onSave(payload));
    if (ok) {
      dirty.current = false;
      setShowErrors(false);
      onClose();
    }
  }

  return (
    <BottomSheet
      visible={visible}
      title={t("workOrders.repair.diagnosis.title")}
      onClose={onClose}
      tall
      testID="wo-diagnosis-sheet"
      footer={<Button label={t("workOrders.repair.diagnosis.save")} onPress={save} loading={busy} disabled={!online || busy} size="lg" testID="wo-diagnosis-save" />}
    >
      <View style={sheetStyles.stack}>
        <Text style={{ color: theme.textSecondary, fontSize: 13.5, lineHeight: 19 }}>{t("workOrders.repair.diagnosis.hint")}</Text>
        <CodePicker
          type="problem"
          label={t("workOrders.repair.diagnosis.problem")}
          state={state}
          selectedId={problemId}
          otherText={problemOther}
          onSelect={edit(setProblemId)}
          onOtherText={edit(setProblemOther)}
          otherInvalid={showErrors && problemOtherMissing}
          disabled={busy}
          testID="wo-dx-problem"
        />
        <CodePicker
          type="cause"
          label={t("workOrders.repair.diagnosis.cause")}
          state={state}
          selectedId={causeId}
          otherText={causeOther}
          onSelect={edit(setCauseId)}
          onOtherText={edit(setCauseOther)}
          otherInvalid={showErrors && causeOtherMissing}
          disabled={busy}
          testID="wo-dx-cause"
        />
        {showErrors && nothingChosen ? <InlineError>{t("workOrders.repair.diagnosis.choose")}</InlineError> : null}
        {!online ? <Note>{t("workOrders.repair.needsConnection")}</Note> : null}
        {error ? <InlineError>{error}</InlineError> : null}
      </View>
    </BottomSheet>
  );
}
